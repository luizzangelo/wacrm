-- ============================================================
-- 041_meta_conversion_stage_outbox
--
-- Atomically moves a deal and, for a mapped target stage, freezes the
-- best eligible CTWA attribution and inserts one durable conversion
-- intent. Delivery to Meta is deliberately outside this transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.move_deal_to_stage_with_conversion_intent(
  p_account_id UUID,
  p_deal_id UUID,
  p_new_stage_id UUID
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
    'meta_conversion_event', v_new_stage.meta_conversion_event
  );

  IF v_deal.stage_id = p_new_stage_id THEN
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
  SET stage_id = p_new_stage_id
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

COMMENT ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID)
IS 'Service-only atomic deal-stage CAS, attribution freeze, and Meta conversion intent insert. Does not call Meta.';

-- Route Handler authentication is the public boundary. The function is
-- intentionally unavailable to browser roles because its invoker must bypass
-- RLS while supplying an account id derived from the authenticated session.
REVOKE ALL ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_deal_to_stage_with_conversion_intent(UUID, UUID, UUID)
  TO service_role;
