BEGIN;

-- Return type changes require recreation; no CASCADE, writes or historical edits.
DROP FUNCTION public.get_deal_conversation_summaries(UUID);
CREATE FUNCTION public.get_deal_conversation_summaries(p_pipeline_id UUID)
RETURNS TABLE(deal_id UUID, conversation_id UUID, last_message_text TEXT,
  last_message_type TEXT, first_inbound_at TIMESTAMPTZ, last_message_sender_type TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, conv.id, LEFT(latest.content_text, 240), latest.content_type,
    first_msg.created_at, latest.sender_type
  FROM public.deals d
  JOIN public.pipelines p ON p.id = d.pipeline_id AND p.account_id = d.account_id
  LEFT JOIN LATERAL (
    SELECT c.id FROM public.conversations c
    WHERE c.account_id = d.account_id AND c.contact_id = d.contact_id
      AND (d.conversation_id IS NULL OR c.id = d.conversation_id)
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC, c.id LIMIT 1
  ) conv ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.content_text, m.content_type, m.sender_type FROM public.messages m
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
COMMIT;
