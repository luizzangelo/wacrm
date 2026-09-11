-- Functional verification for 041_meta_conversion_stage_outbox.sql.
-- Keep this as one top-level statement for `supabase db query --file`.
DO $$
DECLARE
  v_owner_a UUID := uuid_generate_v4();
  v_owner_b UUID := uuid_generate_v4();
  v_account_a UUID;
  v_account_b UUID;
  v_contact_a UUID := uuid_generate_v4();
  v_contact_none UUID := uuid_generate_v4();
  v_contact_future UUID := uuid_generate_v4();
  v_contact_b UUID := uuid_generate_v4();
  v_conversation_a UUID := uuid_generate_v4();
  v_conversation_other UUID := uuid_generate_v4();
  v_conversation_empty UUID := uuid_generate_v4();
  v_conversation_future UUID := uuid_generate_v4();
  v_conversation_b UUID := uuid_generate_v4();
  v_pipeline_a UUID := uuid_generate_v4();
  v_pipeline_b UUID := uuid_generate_v4();
  v_stage_none UUID := uuid_generate_v4();
  v_stage_lead UUID := uuid_generate_v4();
  v_stage_qualified UUID := uuid_generate_v4();
  v_stage_purchase UUID := uuid_generate_v4();
  v_stage_b UUID := uuid_generate_v4();
  v_attribution_conversation UUID := uuid_generate_v4();
  v_attribution_contact UUID := uuid_generate_v4();
  v_attribution_future UUID := uuid_generate_v4();
  v_attribution_b UUID := uuid_generate_v4();
  v_deal_pending UUID := uuid_generate_v4();
  v_deal_missing UUID := uuid_generate_v4();
  v_deal_incomplete UUID := uuid_generate_v4();
  v_deal_disabled UUID := uuid_generate_v4();
  v_deal_no_attribution UUID := uuid_generate_v4();
  v_deal_future UUID := uuid_generate_v4();
  v_deal_fixed UUID := uuid_generate_v4();
  v_deal_fallback UUID := uuid_generate_v4();
  v_deal_rollback UUID := uuid_generate_v4();
  v_deal_created_mapped UUID := uuid_generate_v4();
  v_deal_invalid_current UUID := uuid_generate_v4();
  v_deal_b UUID := uuid_generate_v4();
  v_result JSONB;
  v_count INTEGER;
  v_failed BOOLEAN := FALSE;
BEGIN
  IF to_regprocedure(
    'public.move_deal_to_stage_with_conversion_intent(uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'atomic deal-stage conversion RPC is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.move_deal_to_stage_with_conversion_intent(uuid,uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.move_deal_to_stage_with_conversion_intent(uuid,uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.move_deal_to_stage_with_conversion_intent(uuid,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'RPC grants are not service-role-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = 'public.move_deal_to_stage_with_conversion_intent(uuid,uuid,uuid)'::regprocedure
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'RPC unexpectedly uses SECURITY DEFINER';
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_owner_a, 'meta-stage-owner-a@example.invalid', '{}'::jsonb),
    (v_owner_b, 'meta-stage-owner-b@example.invalid', '{}'::jsonb);

  SELECT account_id INTO v_account_a
  FROM public.profiles WHERE user_id = v_owner_a;
  SELECT account_id INTO v_account_b
  FROM public.profiles WHERE user_id = v_owner_b;

  INSERT INTO public.contacts (id, user_id, account_id, phone, name)
  VALUES
    (v_contact_a, v_owner_a, v_account_a, '+15551000001', 'Stage Contact A'),
    (v_contact_none, v_owner_a, v_account_a, '+15551000002', 'No Attribution'),
    (v_contact_future, v_owner_a, v_account_a, '+15551000003', 'Future Attribution'),
    (v_contact_b, v_owner_b, v_account_b, '+15551000004', 'Stage Contact B');

  INSERT INTO public.conversations (id, user_id, account_id, contact_id)
  VALUES
    (v_conversation_a, v_owner_a, v_account_a, v_contact_a),
    (v_conversation_other, v_owner_a, v_account_a, v_contact_a),
    (v_conversation_empty, v_owner_a, v_account_a, v_contact_a),
    (v_conversation_future, v_owner_a, v_account_a, v_contact_future),
    (v_conversation_b, v_owner_b, v_account_b, v_contact_b);

  INSERT INTO public.pipelines (id, user_id, account_id, name)
  VALUES
    (v_pipeline_a, v_owner_a, v_account_a, 'Stage Outbox A'),
    (v_pipeline_b, v_owner_b, v_account_b, 'Stage Outbox B');

  INSERT INTO public.pipeline_stages (
    id, pipeline_id, name, position, meta_conversion_event
  )
  VALUES
    (v_stage_none, v_pipeline_a, 'None', 0, NULL),
    (v_stage_lead, v_pipeline_a, 'Lead', 1, 'LeadSubmitted'),
    (v_stage_qualified, v_pipeline_a, 'Qualified', 2, 'QualifiedLead'),
    (v_stage_purchase, v_pipeline_a, 'Purchase', 3, 'Purchase'),
    (v_stage_b, v_pipeline_b, 'Foreign', 0, NULL);

  INSERT INTO public.meta_ad_attributions (
    id, account_id, contact_id, conversation_id, ctwa_clid, waba_id,
    received_at
  )
  VALUES
    (
      v_attribution_conversation, v_account_a, v_contact_a,
      v_conversation_a, 'stage-ctwa-conversation', 'stage-waba-a',
      NOW() - INTERVAL '2 hours'
    ),
    (
      v_attribution_contact, v_account_a, v_contact_a,
      v_conversation_other, 'stage-ctwa-contact', 'stage-waba-a',
      NOW() - INTERVAL '1 hour'
    ),
    (
      v_attribution_future, v_account_a, v_contact_future,
      v_conversation_future, 'stage-ctwa-future', 'stage-waba-a',
      NOW() + INTERVAL '1 hour'
    ),
    (
      v_attribution_b, v_account_b, v_contact_b,
      v_conversation_b, 'stage-ctwa-b', 'stage-waba-b', NOW()
    );

  INSERT INTO public.deals (
    id, user_id, account_id, pipeline_id, stage_id, contact_id,
    conversation_id, title, value, currency, meta_attribution_id
  )
  VALUES
    (
      v_deal_pending, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Pending', 321.45, 'BRL', NULL
    ),
    (
      v_deal_missing, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Missing', 10, 'BRL', NULL
    ),
    (
      v_deal_incomplete, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Incomplete', 10, 'BRL', NULL
    ),
    (
      v_deal_disabled, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Disabled', 10, 'BRL', NULL
    ),
    (
      v_deal_no_attribution, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_none, NULL, 'No Attribution', 10, 'BRL', NULL
    ),
    (
      v_deal_future, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_future, v_conversation_future, 'Future', 10, 'BRL', NULL
    ),
    (
      v_deal_fixed, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Fixed', 10, 'BRL', v_attribution_contact
    ),
    (
      v_deal_fallback, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_empty, 'Contact fallback', 10, 'BRL', NULL
    ),
    (
      v_deal_rollback, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      v_contact_a, v_conversation_a, 'Rollback', 10, 'BRL', NULL
    ),
    (
      v_deal_created_mapped, v_owner_a, v_account_a, v_pipeline_a, v_stage_lead,
      v_contact_a, v_conversation_a, 'Created in mapped stage', 10, 'BRL', NULL
    ),
    (
      v_deal_invalid_current, v_owner_a, v_account_a, v_pipeline_a, v_stage_b,
      v_contact_a, v_conversation_a, 'Invalid current', 10, 'BRL', NULL
    ),
    (
      v_deal_b, v_owner_b, v_account_b, v_pipeline_b, v_stage_b,
      v_contact_b, v_conversation_b, 'Foreign deal', 10, 'USD', v_attribution_b
    );

  INSERT INTO public.meta_conversion_config (
    account_id, dataset_id, access_token, enabled
  ) VALUES (v_account_a, 'stage-dataset', 'stage-ciphertext', TRUE);

  -- Browser roles cannot call the privileged function directly.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.move_deal_to_stage_with_conversion_intent(
      v_account_a, v_deal_pending, v_stage_lead
    );
    RAISE EXCEPTION 'anon executed privileged RPC' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.move_deal_to_stage_with_conversion_intent(
      v_account_a, v_deal_pending, v_stage_lead
    );
    RAISE EXCEPTION 'authenticated executed privileged RPC' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  EXECUTE 'SET LOCAL ROLE service_role';

  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_lead
  ) INTO v_result;

  IF v_result->>'changed' <> 'true'
    OR v_result->>'conversionEventCreated' <> 'true'
    OR v_result->>'conversionEventStatus' <> 'pending'
    OR v_result->>'conversionEventName' <> 'LeadSubmitted'
  THEN
    RAISE EXCEPTION 'valid mapped move did not create a pending intent: %', v_result;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.meta_conversion_events AS e
  WHERE e.account_id = v_account_a
    AND e.deal_id = v_deal_pending
    AND e.attribution_id = v_attribution_conversation
    AND e.stage_id = v_stage_lead
    AND e.event_name = 'LeadSubmitted'
    AND e.event_id = 'meta:' || v_account_a::TEXT || ':'
      || v_deal_pending::TEXT || ':LeadSubmitted'
    AND e.value IS NULL
    AND e.currency IS NULL
    AND e.status = 'pending'
    AND e.attempts = 0
    AND e.meta_http_status IS NULL
    AND e.meta_response IS NULL
    AND e.error_message IS NULL
    AND e.sent_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pending LeadSubmitted snapshot is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.deals
    WHERE id = v_deal_pending
      AND stage_id = v_stage_lead
      AND meta_attribution_id = v_attribution_conversation
  ) THEN
    RAISE EXCEPTION 'conversation-priority attribution was not frozen';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_created_mapped
  ) THEN
    RAISE EXCEPTION 'deal creation in a mapped stage created an intent';
  END IF;

  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_rollback, v_stage_none
  ) INTO v_result;
  IF v_result->>'changed' <> 'false'
    OR v_result->>'reason' <> 'same_stage'
    OR EXISTS (
      SELECT 1 FROM public.meta_conversion_events
      WHERE deal_id = v_deal_rollback
    )
  THEN
    RAISE EXCEPTION 'same-stage request was not an event-free no-op';
  END IF;

  -- An unmapped move and then a repeated mapped milestone both succeed,
  -- but the uniqueness boundary preserves the original intent.
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_none
  );
  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_lead
  ) INTO v_result;

  SELECT count(*) INTO v_count
  FROM public.meta_conversion_events
  WHERE account_id = v_account_a
    AND deal_id = v_deal_pending
    AND event_name = 'LeadSubmitted';
  IF v_result->>'changed' <> 'true'
    OR v_result->>'conversionEventCreated' <> 'false'
    OR v_count <> 1
  THEN
    RAISE EXCEPTION 'mapped-stage replay was not idempotent: %', v_result;
  END IF;

  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_qualified
  );
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_purchase
  );

  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_none
  );
  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_qualified
  ) INTO v_result;
  IF v_result->>'conversionEventCreated' <> 'false' THEN
    RAISE EXCEPTION 'QualifiedLead replay created another intent';
  END IF;

  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_none
  );
  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_pending, v_stage_purchase
  ) INTO v_result;
  IF v_result->>'conversionEventCreated' <> 'false' THEN
    RAISE EXCEPTION 'Purchase replay created another intent';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_pending
      AND event_name IN ('LeadSubmitted', 'QualifiedLead')
      AND (value IS NOT NULL OR currency IS NOT NULL)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_pending
      AND event_name = 'Purchase'
      AND value = 321.45
      AND currency = 'BRL'
  ) THEN
    RAISE EXCEPTION 'milestone value/currency snapshots are incorrect';
  END IF;

  DELETE FROM public.meta_conversion_config WHERE account_id = v_account_a;
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_missing, v_stage_lead
  );

  INSERT INTO public.meta_conversion_config (
    account_id, dataset_id, access_token, enabled
  ) VALUES (v_account_a, NULL, 'stage-ciphertext', FALSE);
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_incomplete, v_stage_lead
  );

  UPDATE public.meta_conversion_config
  SET dataset_id = 'stage-dataset', enabled = FALSE
  WHERE account_id = v_account_a;
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_disabled, v_stage_lead
  );

  UPDATE public.meta_conversion_config
  SET enabled = TRUE
  WHERE account_id = v_account_a;
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_no_attribution, v_stage_lead
  );
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_future, v_stage_lead
  );
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_fixed, v_stage_lead
  );
  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_fallback, v_stage_lead
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_missing AND status = 'skipped_missing_config'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_incomplete AND status = 'skipped_missing_config'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_disabled AND status = 'skipped_disabled'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_no_attribution AND status = 'skipped_no_attribution'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_future AND status = 'skipped_no_attribution'
      AND attribution_id IS NULL
  ) THEN
    RAISE EXCEPTION 'conversion intent status precedence is incorrect';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.deals
    WHERE id = v_deal_future AND meta_attribution_id IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_fixed
      AND attribution_id = v_attribution_contact
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deals
    WHERE id = v_deal_fallback
      AND meta_attribution_id = v_attribution_contact
  ) THEN
    RAISE EXCEPTION 'future/fixed/fallback attribution rules are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.deals
    WHERE id = v_deal_disabled
      AND meta_attribution_id = v_attribution_conversation
  ) THEN
    RAISE EXCEPTION 'disabled conversion did not freeze valid attribution';
  END IF;

  PERFORM public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_disabled, v_stage_qualified
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_disabled
      AND event_name = 'QualifiedLead'
      AND status = 'pending'
      AND attribution_id = v_attribution_conversation
  ) THEN
    RAISE EXCEPTION 'later milestone did not reuse disabled-event attribution';
  END IF;

  -- Forged cross-account ids and cross-pipeline stages are rejected.
  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_b, v_stage_lead
  ) INTO v_result;
  IF v_result->>'error' <> 'deal_not_found' THEN
    RAISE EXCEPTION 'cross-account deal was exposed: %', v_result;
  END IF;

  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_missing, v_stage_b
  ) INTO v_result;
  IF v_result->>'error' <> 'stage_not_available' THEN
    RAISE EXCEPTION 'cross-account target stage was accepted: %', v_result;
  END IF;

  SELECT public.move_deal_to_stage_with_conversion_intent(
    v_account_a, v_deal_invalid_current, v_stage_lead
  ) INTO v_result;
  IF v_result->>'error' <> 'invalid_current_stage' THEN
    RAISE EXCEPTION 'invalid current stage was accepted: %', v_result;
  END IF;

  EXECUTE 'RESET ROLE';

  -- Force the outbox INSERT to fail and prove that both the stage update
  -- and attribution freeze roll back with it.
  EXECUTE $ddl$
    CREATE FUNCTION public.fail_meta_stage_outbox_test()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = ''
    AS $fn$
    BEGIN
      RAISE EXCEPTION 'forced outbox failure' USING ERRCODE = 'P0001';
    END;
    $fn$
  $ddl$;
  EXECUTE $ddl$
    CREATE TRIGGER fail_meta_stage_outbox_test
    BEFORE INSERT ON public.meta_conversion_events
    FOR EACH ROW EXECUTE FUNCTION public.fail_meta_stage_outbox_test()
  $ddl$;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.move_deal_to_stage_with_conversion_intent(
      v_account_a, v_deal_rollback, v_stage_lead
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := TRUE;
  END;
  EXECUTE 'RESET ROLE';

  DROP TRIGGER fail_meta_stage_outbox_test ON public.meta_conversion_events;
  DROP FUNCTION public.fail_meta_stage_outbox_test();

  IF NOT v_failed OR NOT EXISTS (
    SELECT 1 FROM public.deals
    WHERE id = v_deal_rollback
      AND stage_id = v_stage_none
      AND meta_attribution_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.meta_conversion_events
    WHERE deal_id = v_deal_rollback
  ) THEN
    RAISE EXCEPTION 'outbox failure did not atomically roll back the move';
  END IF;

  DELETE FROM public.accounts WHERE id IN (v_account_a, v_account_b);
  DELETE FROM auth.users WHERE id IN (v_owner_a, v_owner_b);

  RAISE NOTICE 'Meta conversion stage outbox verification passed';
END
$$;
