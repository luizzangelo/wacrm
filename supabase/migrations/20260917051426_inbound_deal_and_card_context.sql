BEGIN;

CREATE INDEX idx_deals_account_contact ON public.deals(account_id, contact_id);
CREATE INDEX idx_messages_conversation_chronology
  ON public.messages(conversation_id, created_at, id);
CREATE INDEX idx_messages_first_customer
  ON public.messages(conversation_id, created_at, id) WHERE sender_type = 'customer';

-- Same transaction lock for inbound checks, manual inserts and stage updates.
-- No uniqueness restriction on intentional manual deals or historical rows.
CREATE FUNCTION public.lock_deal_contact_context()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      NEW.account_id::text || ':' || NEW.contact_id::text, 0));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_lock_deal_contact_context BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.lock_deal_contact_context();
REVOKE ALL ON FUNCTION public.lock_deal_contact_context() FROM PUBLIC, anon, authenticated;

-- Cloud webhook persists a genuine customer message before attribution capture.
-- Duplicate upserts DO NOTHING, so this trigger never runs on webhook replay.
CREATE FUNCTION public.create_deal_on_whatsapp_inbound()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_conv public.conversations%ROWTYPE; v_pipeline UUID; v_currency TEXT;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres')
    OR NEW.sender_type <> 'customer' OR NEW.message_id IS NULL
    OR NOT (NULLIF(BTRIM(NEW.content_text), '') IS NOT NULL
      OR NEW.content_type IN ('image','document','audio','video','location','interactive'))
  THEN RETURN NEW; END IF;

  SELECT c.* INTO v_conv FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = c.account_id
    WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_conv.account_id::text || ':' || v_conv.contact_id::text, 0));
  -- Non-lost includes won: user explicitly defined openness by technical stage.
  IF EXISTS (SELECT 1 FROM public.deals d
    JOIN public.pipelines p ON p.id = d.pipeline_id AND p.account_id = d.account_id
    JOIN public.pipeline_stages s ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id
    WHERE d.account_id = v_conv.account_id AND d.contact_id = v_conv.contact_id
      AND NOT s.is_lost_stage) THEN RETURN NEW; END IF;

  -- Existing UI default is the oldest pipeline. Skip unconfigured pipelines.
  SELECT p.id INTO v_pipeline FROM public.pipelines p
    WHERE p.account_id = v_conv.account_id AND EXISTS (
      SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = p.id AND NOT s.is_lost_stage)
    ORDER BY p.created_at, p.id LIMIT 1;
  IF NOT FOUND THEN
    RAISE WARNING 'whatsapp_auto_deal_skipped: no_configured_pipeline';
    RETURN NEW; -- Keep inbound functional; never invent a pipeline/mapping.
  END IF;

  SELECT a.default_currency INTO v_currency FROM public.accounts a WHERE a.id = v_conv.account_id;

  -- Stage/title supplied by the existing lifecycle guard; insert never calls
  -- the movement RPC and never freezes attribution or creates a Meta intent.
  INSERT INTO public.deals(account_id,user_id,pipeline_id,contact_id,conversation_id,currency)
    VALUES(v_conv.account_id,v_conv.user_id,v_pipeline,v_conv.contact_id,v_conv.id,v_currency);
  RETURN NEW;
END $$;
CREATE TRIGGER create_deal_on_whatsapp_inbound AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.create_deal_on_whatsapp_inbound();
REVOKE ALL ON FUNCTION public.create_deal_on_whatsapp_inbound() FROM PUBLIC, anon, authenticated;

-- Batch, read-only, RLS-preserving card data; no per-card requests or media URLs.
CREATE FUNCTION public.get_deal_conversation_summaries(p_pipeline_id UUID)
RETURNS TABLE(deal_id UUID, conversation_id UUID, last_message_text TEXT,
  last_message_type TEXT, first_inbound_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, conv.id, LEFT(latest.content_text, 240), latest.content_type, first_msg.created_at
  FROM public.deals d
  JOIN public.pipelines p ON p.id = d.pipeline_id AND p.account_id = d.account_id
  LEFT JOIN LATERAL (
    SELECT c.id FROM public.conversations c
    WHERE c.account_id = d.account_id AND c.contact_id = d.contact_id
      AND (d.conversation_id IS NULL OR c.id = d.conversation_id)
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC, c.id LIMIT 1
  ) conv ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.content_text, m.content_type FROM public.messages m
    WHERE m.conversation_id = conv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.created_at FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.account_id = d.account_id AND c.contact_id = d.contact_id
      AND conv.id IS NOT NULL AND m.sender_type = 'customer'
    ORDER BY m.created_at, m.id LIMIT 1
  ) first_msg ON TRUE
  WHERE d.pipeline_id = p_pipeline_id;
$$;
REVOKE ALL ON FUNCTION public.get_deal_conversation_summaries(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deal_conversation_summaries(UUID) TO authenticated, service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'deals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
  END IF;
END $$;

COMMIT;
