-- Deal creation/loss lifecycle. No HTTP, no worker/delivery changes.
BEGIN;
LOCK TABLE public.pipelines, public.pipeline_stages, public.deals
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.pipeline_stages
  ADD COLUMN is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.deals
  ADD COLUMN lost_reason TEXT,
  ADD COLUMN lost_reason_notes TEXT;

-- Reuse a uniquely named, unmapped Portuguese/English lost stage. Ambiguous
-- names or mapped stages stay untouched; add a separate technical stage.
DO $$
DECLARE p RECORD; candidate UUID;
BEGIN
  FOR p IN SELECT id FROM public.pipelines LOOP
    SELECT CASE WHEN count(*) = 1 AND bool_and(meta_conversion_event IS NULL)
      THEN (array_agg(id))[1] ELSE NULL END
      INTO candidate FROM public.pipeline_stages
      WHERE pipeline_id = p.id
        AND lower(btrim(name)) IN ('venda perdida', 'lost sale');
    IF candidate IS NOT NULL THEN
      UPDATE public.pipeline_stages SET is_lost_stage = TRUE
        WHERE id = candidate;
    ELSE
      INSERT INTO public.pipeline_stages
        (pipeline_id,name,position,color,is_lost_stage,meta_conversion_event)
      VALUES (p.id,'Venda perdida',0,'#ef4444',TRUE,NULL);
    END IF;
  END LOOP;
END $$;

UPDATE public.pipeline_stages ls SET position = (
  SELECT COALESCE(max(s.position), -1) + 1 FROM public.pipeline_stages s
  WHERE s.pipeline_id = ls.pipeline_id AND NOT s.is_lost_stage
) WHERE ls.is_lost_stage;

-- Historical status=lost deals are relocated without creating intents.
-- Unknown historical reasons use 'other', never fabricated specific reasons.
UPDATE public.deals d SET stage_id = ls.id, status = 'lost',
  lost_reason = 'other'
FROM public.pipeline_stages ls
WHERE ls.pipeline_id = d.pipeline_id AND ls.is_lost_stage
  AND (d.status = 'lost' OR d.stage_id = ls.id);

CREATE UNIQUE INDEX idx_pipeline_stages_one_lost
  ON public.pipeline_stages(pipeline_id) WHERE is_lost_stage;
CREATE INDEX idx_pipeline_stages_normal_order
  ON public.pipeline_stages(pipeline_id,position,id) WHERE NOT is_lost_stage;
ALTER TABLE public.pipeline_stages ADD CONSTRAINT lost_stage_unmapped
  CHECK (NOT is_lost_stage OR meta_conversion_event IS NULL);
ALTER TABLE public.deals ADD CONSTRAINT deals_lost_reason_code
  CHECK (lost_reason IS NULL OR lost_reason IN (
    'price','no_interest','no_budget','no_response','competitor',
    'unavailable','bad_timing','unqualified','other'));
ALTER TABLE public.deals ADD CONSTRAINT deals_lost_reason_required
  CHECK (status IS DISTINCT FROM 'lost' OR lost_reason IS NOT NULL);
ALTER TABLE public.deals ADD CONSTRAINT deals_lost_notes_length
  CHECK (lost_reason_notes IS NULL OR length(lost_reason_notes) <= 4000);

CREATE FUNCTION public.initialize_pipeline_lost_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.pipeline_stages
    (pipeline_id,name,position,color,is_lost_stage,meta_conversion_event)
  VALUES (NEW.id,'Venda perdida',0,'#ef4444',TRUE,NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_pipeline_lost_stage AFTER INSERT ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.initialize_pipeline_lost_stage();

-- Only the pipeline owner/admin can modify stages, under existing RLS.
-- Keep the technical identity/pipeline fixed; pipeline deletion still cascades.
CREATE FUNCTION public.protect_pipeline_stage_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id OR
    NEW.is_lost_stage IS DISTINCT FROM OLD.is_lost_stage
  ) THEN
    RAISE EXCEPTION 'stage_identity_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_pipeline_stage_identity BEFORE UPDATE
  ON public.pipeline_stages FOR EACH ROW
  EXECUTE FUNCTION public.protect_pipeline_stage_identity();

CREATE FUNCTION public.position_pipeline_lost_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE pipeline UUID; last_position INTEGER;
BEGIN
  pipeline := CASE WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END;
  -- Serialize stage writers per pipeline. Empty/no-longer-visible parents
  -- during cascades are intentionally skipped.
  PERFORM 1 FROM public.pipelines WHERE id = pipeline FOR UPDATE;
  SELECT COALESCE(max(position), -1) + 1 INTO last_position
    FROM public.pipeline_stages WHERE pipeline_id = pipeline AND NOT is_lost_stage;
  UPDATE public.pipeline_stages SET position = last_position
    WHERE pipeline_id = pipeline AND is_lost_stage
      AND position IS DISTINCT FROM last_position;
  RETURN NULL;
END $$;
CREATE TRIGGER position_pipeline_lost_stage AFTER INSERT OR UPDATE OR DELETE
  ON public.pipeline_stages FOR EACH ROW
  EXECUTE FUNCTION public.position_pipeline_lost_stage();

CREATE FUNCTION public.require_pipeline_lost_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE pipeline UUID;
BEGIN
  IF TG_TABLE_NAME = 'pipelines' THEN pipeline := NEW.id;
  ELSE pipeline := CASE WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE id = pipeline) AND
    (SELECT count(*) FROM public.pipeline_stages
      WHERE pipeline_id = pipeline AND is_lost_stage) <> 1 THEN
    RAISE EXCEPTION 'pipeline_requires_one_lost_stage' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_pipeline_lost_stage
  AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.require_pipeline_lost_stage();
CREATE CONSTRAINT TRIGGER require_new_pipeline_lost_stage
  AFTER INSERT ON public.pipelines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.require_pipeline_lost_stage();

CREATE FUNCTION public.guard_deal_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE s public.pipeline_stages%ROWTYPE; contact_name TEXT; old_lost BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = NEW.pipeline_id AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'pipeline_not_available' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.account_id IS DISTINCT FROM OLD.account_id OR
    NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
  ) THEN
    RAISE EXCEPTION 'deal_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name INTO contact_name FROM public.contacts c
      WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contact_not_available' USING ERRCODE = '23514';
    END IF;
    NEW.title := COALESCE(contact_name, '');
  ELSIF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'contact_required' USING ERRCODE = '23514';
  ELSIF NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.title := OLD.title; -- deleted-contact compatibility, never editable
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id
      AND c.account_id = NEW.account_id
      AND (NEW.contact_id IS NULL OR c.contact_id = NEW.contact_id)
  ) THEN
    RAISE EXCEPTION 'conversation_not_available' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- All creation paths (including service-role automations) share this rule.
    -- stage_id/title may be omitted: BEFORE INSERT fills their NOT NULL values.
    SELECT ps.* INTO s FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = NEW.pipeline_id AND NOT ps.is_lost_stage
      ORDER BY ps.position, ps.id LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipeline_has_no_normal_stage' USING ERRCODE = '23514';
    END IF;
    NEW.stage_id := s.id;
    NEW.status := 'open';
    NEW.lost_reason := NULL;
    NEW.lost_reason_notes := NULL;
  ELSE
    -- Browser callers must use the authenticated, role-gated central route.
    -- A direct update cannot bypass its loss validation or mapped outbox.
    IF current_user IN ('authenticated', 'anon') AND (
      NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
      NEW.lost_reason IS DISTINCT FROM OLD.lost_reason OR
      NEW.lost_reason_notes IS DISTINCT FROM OLD.lost_reason_notes
    ) THEN
      RAISE EXCEPTION 'stage_move_requires_central_rpc' USING ERRCODE = '23514';
    END IF;
    SELECT ps.* INTO s FROM public.pipeline_stages ps
      WHERE ps.id = NEW.stage_id AND ps.pipeline_id = NEW.pipeline_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stage_not_available' USING ERRCODE = '23514';
    END IF;
    IF s.is_lost_stage THEN
      IF NEW.lost_reason IS NULL THEN
        RAISE EXCEPTION 'lost_reason_required' USING ERRCODE = '23514';
      END IF;
      NEW.status := 'lost';
    ELSE
      SELECT is_lost_stage INTO old_lost FROM public.pipeline_stages
        WHERE id = OLD.stage_id;
      IF old_lost THEN NEW.status := 'open'; END IF;
      IF NEW.status = 'lost' THEN
        RAISE EXCEPTION 'lost_status_requires_lost_stage' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_deal_lifecycle BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_lifecycle();

-- Tenancy of a pipeline with stages/deals cannot be reassigned after creation.
CREATE FUNCTION public.protect_pipeline_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'pipeline_identity_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_pipeline_account BEFORE UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.protect_pipeline_account();

REVOKE ALL ON FUNCTION public.initialize_pipeline_lost_stage(),
  public.protect_pipeline_stage_identity(), public.position_pipeline_lost_stage(),
  public.require_pipeline_lost_stage(), public.guard_deal_lifecycle(),
  public.protect_pipeline_account() FROM PUBLIC, anon, authenticated;

-- Replace, do not overload: three-argument callers remain supported by defaults.
DROP FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.move_deal_to_stage_with_conversion_intent(
  p_account_id UUID,
  p_deal_id UUID,
  p_new_stage_id UUID,
  p_lost_reason TEXT DEFAULT NULL,
  p_lost_reason_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_current_deal public.deals%ROWTYPE;
  v_old_stage public.pipeline_stages%ROWTYPE;
  v_new_stage public.pipeline_stages%ROWTYPE;
  v_config public.meta_conversion_config%ROWTYPE;
  v_attribution public.meta_ad_attributions%ROWTYPE;
  v_event public.meta_conversion_events%ROWTYPE;
  v_event_time TIMESTAMPTZ := NOW();
  v_event_id TEXT;
  v_event_status TEXT;
  v_has_config BOOLEAN := FALSE;
  v_found_attribution BOOLEAN := FALSE;
  v_attribution_valid BOOLEAN := FALSE;
  v_event_created BOOLEAN := FALSE;
  v_deal_json JSONB;
  v_stage_json JSONB;
BEGIN
  IF p_account_id IS NULL OR p_deal_id IS NULL OR p_new_stage_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_identifier');
  END IF;

  SELECT d.*
  INTO v_deal
  FROM public.deals AS d
  WHERE d.id = p_deal_id
    AND d.account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'deal_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pipelines AS p
    WHERE p.id = v_deal.pipeline_id
      AND p.account_id = p_account_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_current_stage');
  END IF;

  SELECT ps.*
  INTO v_old_stage
  FROM public.pipeline_stages AS ps
  WHERE ps.id = v_deal.stage_id
    AND ps.pipeline_id = v_deal.pipeline_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_current_stage');
  END IF;

  SELECT ps.*
  INTO v_new_stage
  FROM public.pipeline_stages AS ps
  WHERE ps.id = p_new_stage_id
    AND ps.pipeline_id = v_deal.pipeline_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'stage_not_available');
  END IF;

  v_stage_json := jsonb_build_object(
    'id', v_new_stage.id,
    'pipeline_id', v_new_stage.pipeline_id,
    'meta_conversion_event', v_new_stage.meta_conversion_event,
    'is_lost_stage', v_new_stage.is_lost_stage
  );

  -- Loss validation is BEFORE the same-stage shortcut and every write.
  IF v_new_stage.is_lost_stage AND (
    p_lost_reason IS NULL OR p_lost_reason NOT IN (
      'price', 'no_interest', 'no_budget', 'no_response', 'competitor',
      'unavailable', 'bad_timing', 'unqualified', 'other'
    )
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'lost_reason_required');
  END IF;
  IF p_lost_reason_notes IS NOT NULL AND length(p_lost_reason_notes) > 4000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_loss_notes');
  END IF;

  IF v_deal.stage_id = p_new_stage_id THEN
    -- Editing the reason on an already-lost deal is the same central RPC;
    -- it cannot reach attribution selection or the outbox.
    IF v_new_stage.is_lost_stage THEN
      UPDATE public.deals d
      SET lost_reason = p_lost_reason,
          lost_reason_notes = NULLIF(BTRIM(p_lost_reason_notes), '')
      WHERE d.id = p_deal_id AND d.account_id = p_account_id
        AND d.stage_id = p_new_stage_id
      RETURNING d.* INTO v_deal;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'stage_conflict');
      END IF;
    END IF;
    v_deal_json := jsonb_build_object(
      'id', v_deal.id,
      'user_id', v_deal.user_id,
      'pipeline_id', v_deal.pipeline_id,
      'stage_id', v_deal.stage_id,
      'contact_id', v_deal.contact_id,
      'conversation_id', v_deal.conversation_id,
      'title', v_deal.title,
      'value', v_deal.value,
      'currency', v_deal.currency,
      'assigned_to', v_deal.assigned_to,
      'notes', v_deal.notes,
      'expected_close_date', v_deal.expected_close_date,
      'status', v_deal.status,
      'lost_reason', v_deal.lost_reason,
      'lost_reason_notes', v_deal.lost_reason_notes,
      'meta_attribution_id', v_deal.meta_attribution_id,
      'created_at', v_deal.created_at,
      'updated_at', v_deal.updated_at
    );

    RETURN jsonb_build_object(
      'ok', TRUE,
      'changed', FALSE,
      'reason', 'same_stage',
      'oldStageId', v_deal.stage_id,
      'newStageId', p_new_stage_id,
      'deal', v_deal_json,
      'newStage', v_stage_json,
      'conversionEventCreated', FALSE,
      'conversionEventStatus', NULL,
      'conversionEventName', NULL
    );
  END IF;

  -- Compare-and-set is the concurrency boundary. The UPDATE locks only
  -- the winning deal row and that lock is retained until this RPC ends.
  UPDATE public.deals AS d
  SET stage_id = p_new_stage_id,
      status = CASE WHEN v_new_stage.is_lost_stage THEN 'lost'
        WHEN v_old_stage.is_lost_stage THEN 'open' ELSE d.status END,
      lost_reason = CASE WHEN v_new_stage.is_lost_stage
        THEN p_lost_reason ELSE d.lost_reason END,
      lost_reason_notes = CASE WHEN v_new_stage.is_lost_stage
        THEN NULLIF(BTRIM(p_lost_reason_notes), '') ELSE d.lost_reason_notes END
  WHERE d.id = p_deal_id
    AND d.account_id = p_account_id
    AND d.stage_id = v_deal.stage_id
  RETURNING d.* INTO v_deal;

  IF NOT FOUND THEN
    SELECT d.*
    INTO v_current_deal
    FROM public.deals AS d
    WHERE d.id = p_deal_id
      AND d.account_id = p_account_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'deal_not_found');
    END IF;

    IF v_current_deal.stage_id = p_new_stage_id THEN
      v_deal_json := jsonb_build_object(
        'id', v_current_deal.id,
        'user_id', v_current_deal.user_id,
        'pipeline_id', v_current_deal.pipeline_id,
        'stage_id', v_current_deal.stage_id,
        'contact_id', v_current_deal.contact_id,
        'conversation_id', v_current_deal.conversation_id,
        'title', v_current_deal.title,
        'value', v_current_deal.value,
        'currency', v_current_deal.currency,
        'assigned_to', v_current_deal.assigned_to,
        'notes', v_current_deal.notes,
        'expected_close_date', v_current_deal.expected_close_date,
        'status', v_current_deal.status,
        'lost_reason', v_current_deal.lost_reason,
        'lost_reason_notes', v_current_deal.lost_reason_notes,
        'meta_attribution_id', v_current_deal.meta_attribution_id,
        'created_at', v_current_deal.created_at,
        'updated_at', v_current_deal.updated_at
      );

      RETURN jsonb_build_object(
        'ok', TRUE,
        'changed', FALSE,
        'reason', 'same_stage',
        'oldStageId', v_current_deal.stage_id,
        'newStageId', p_new_stage_id,
        'deal', v_deal_json,
        'newStage', v_stage_json,
        'conversionEventCreated', FALSE,
        'conversionEventStatus', NULL,
        'conversionEventName', NULL
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', FALSE,
      'error', 'stage_conflict',
      'currentStageId', v_current_deal.stage_id
    );
  END IF;

  -- Unmapped targets only move the deal. They do not inspect config,
  -- freeze attribution, or create an outbox row.
  IF v_new_stage.meta_conversion_event IS NOT NULL THEN
    IF v_deal.meta_attribution_id IS NOT NULL THEN
      -- A frozen attribution always wins. Do not silently replace it with
      -- a newer click, even if the frozen snapshot is incomplete.
      SELECT a.*
      INTO v_attribution
      FROM public.meta_ad_attributions AS a
      WHERE a.id = v_deal.meta_attribution_id
        AND a.account_id = p_account_id;

      v_attribution_valid := FOUND
        AND NULLIF(BTRIM(v_attribution.ctwa_clid), '') IS NOT NULL
        AND NULLIF(BTRIM(v_attribution.waba_id), '') IS NOT NULL;
    ELSIF v_deal.contact_id IS NOT NULL THEN
      -- Prefer the newest valid click from this exact conversation, but
      -- never use a click received after this event's database timestamp.
      IF v_deal.conversation_id IS NOT NULL THEN
        SELECT a.*
        INTO v_attribution
        FROM public.meta_ad_attributions AS a
        WHERE a.account_id = p_account_id
          AND a.contact_id = v_deal.contact_id
          AND a.conversation_id = v_deal.conversation_id
          AND a.received_at <= v_event_time
          AND NULLIF(BTRIM(a.ctwa_clid), '') IS NOT NULL
          AND NULLIF(BTRIM(a.waba_id), '') IS NOT NULL
        ORDER BY a.received_at DESC, a.created_at DESC, a.id DESC
        LIMIT 1;

        v_found_attribution := FOUND;
      END IF;

      IF NOT v_found_attribution THEN
        SELECT a.*
        INTO v_attribution
        FROM public.meta_ad_attributions AS a
        WHERE a.account_id = p_account_id
          AND a.contact_id = v_deal.contact_id
          AND a.received_at <= v_event_time
          AND NULLIF(BTRIM(a.ctwa_clid), '') IS NOT NULL
          AND NULLIF(BTRIM(a.waba_id), '') IS NOT NULL
        ORDER BY a.received_at DESC, a.created_at DESC, a.id DESC
        LIMIT 1;

        v_found_attribution := FOUND;
      END IF;

      v_attribution_valid := v_found_attribution;

      IF v_attribution_valid THEN
        UPDATE public.deals AS d
        SET meta_attribution_id = v_attribution.id
        WHERE d.id = p_deal_id
          AND d.account_id = p_account_id
        RETURNING d.* INTO v_deal;
      END IF;
    END IF;

    SELECT c.*
    INTO v_config
    FROM public.meta_conversion_config AS c
    WHERE c.account_id = p_account_id;
    v_has_config := FOUND;

    IF NOT v_has_config
      OR NULLIF(BTRIM(v_config.dataset_id), '') IS NULL
      OR NULLIF(BTRIM(v_config.access_token), '') IS NULL
    THEN
      v_event_status := 'skipped_missing_config';
    ELSIF NOT v_config.enabled THEN
      v_event_status := 'skipped_disabled';
    ELSIF NOT v_attribution_valid THEN
      v_event_status := 'skipped_no_attribution';
    ELSE
      v_event_status := 'pending';
    END IF;

    v_event_id := 'meta:' || p_account_id::TEXT || ':' || p_deal_id::TEXT
      || ':' || v_new_stage.meta_conversion_event;

    INSERT INTO public.meta_conversion_events (
      account_id,
      deal_id,
      contact_id,
      attribution_id,
      stage_id,
      event_name,
      event_id,
      event_time,
      value,
      currency,
      status,
      attempts,
      meta_http_status,
      meta_response,
      error_message,
      sent_at
    )
    VALUES (
      p_account_id,
      p_deal_id,
      v_deal.contact_id,
      CASE WHEN v_deal.meta_attribution_id IS NOT NULL
        THEN v_deal.meta_attribution_id
        ELSE NULL
      END,
      p_new_stage_id,
      v_new_stage.meta_conversion_event,
      v_event_id,
      v_event_time,
      CASE WHEN v_new_stage.meta_conversion_event = 'Purchase'
        THEN v_deal.value
        ELSE NULL
      END,
      CASE WHEN v_new_stage.meta_conversion_event = 'Purchase'
        THEN v_deal.currency
        ELSE NULL
      END,
      v_event_status,
      0,
      NULL,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_event;

    v_event_created := FOUND;

    IF NOT v_event_created THEN
      SELECT e.*
      INTO v_event
      FROM public.meta_conversion_events AS e
      WHERE e.account_id = p_account_id
        AND e.deal_id = p_deal_id
        AND e.event_name = v_new_stage.meta_conversion_event;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'conversion event idempotency conflict could not be resolved'
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  v_deal_json := jsonb_build_object(
    'id', v_deal.id,
    'user_id', v_deal.user_id,
    'pipeline_id', v_deal.pipeline_id,
    'stage_id', v_deal.stage_id,
    'contact_id', v_deal.contact_id,
    'conversation_id', v_deal.conversation_id,
    'title', v_deal.title,
    'value', v_deal.value,
    'currency', v_deal.currency,
    'assigned_to', v_deal.assigned_to,
    'notes', v_deal.notes,
    'expected_close_date', v_deal.expected_close_date,
    'status', v_deal.status,
    'lost_reason', v_deal.lost_reason,
    'lost_reason_notes', v_deal.lost_reason_notes,
    'meta_attribution_id', v_deal.meta_attribution_id,
    'created_at', v_deal.created_at,
    'updated_at', v_deal.updated_at
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'changed', TRUE,
    'oldStageId', v_old_stage.id,
    'newStageId', p_new_stage_id,
    'deal', v_deal_json,
    'newStage', v_stage_json,
    'conversionEventCreated', v_event_created,
    'conversionEventStatus', CASE
      WHEN v_new_stage.meta_conversion_event IS NULL THEN NULL
      ELSE v_event.status
    END,
    'conversionEventName', v_new_stage.meta_conversion_event
  );
END;
$$;

COMMENT ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID, TEXT, TEXT)
IS 'Service-only atomic deal-stage CAS, attribution freeze, and Meta conversion intent insert. Does not call Meta.';

-- Route Handler authentication is the public boundary. The function is
-- intentionally unavailable to browser roles because its invoker must bypass
-- RLS while supplying an account id derived from the authenticated session.
REVOKE ALL ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID, TEXT, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMIT;
