-- Functional verification for 040_meta_conversions_foundation.sql.
-- Keep this as exactly one statement: `supabase db query --file` sends
-- the file as a prepared statement and rejects multiple top-level commands.
DO $$
DECLARE
  v_owner_a UUID := uuid_generate_v4();
  v_admin_a UUID := uuid_generate_v4();
  v_viewer_a UUID := uuid_generate_v4();
  v_owner_b UUID := uuid_generate_v4();
  v_account_a UUID;
  v_account_b UUID;
  v_admin_personal_account UUID;
  v_viewer_personal_account UUID;
  v_contact_a UUID := uuid_generate_v4();
  v_contact_b UUID := uuid_generate_v4();
  v_conversation_a UUID := uuid_generate_v4();
  v_conversation_b UUID := uuid_generate_v4();
  v_whatsapp_a UUID := uuid_generate_v4();
  v_whatsapp_b UUID := uuid_generate_v4();
  v_attribution_a UUID := uuid_generate_v4();
  v_attribution_b UUID := uuid_generate_v4();
  v_pipeline_a UUID := uuid_generate_v4();
  v_pipeline_b UUID := uuid_generate_v4();
  v_stage_none UUID := uuid_generate_v4();
  v_stage_lead UUID := uuid_generate_v4();
  v_stage_qualified UUID := uuid_generate_v4();
  v_stage_purchase UUID := uuid_generate_v4();
  v_stage_b UUID := uuid_generate_v4();
  v_deal_a UUID := uuid_generate_v4();
  v_deal_a_2 UUID := uuid_generate_v4();
  v_deal_b UUID := uuid_generate_v4();
  v_count INTEGER;
  v_status TEXT;
BEGIN
  -- Structural smoke checks.
  IF to_regclass('public.meta_conversion_config') IS NULL
    OR to_regclass('public.meta_ad_attributions') IS NULL
    OR to_regclass('public.meta_conversion_events') IS NULL
  THEN
    RAISE EXCEPTION 'one or more Meta foundation tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN (
      'public.meta_conversion_config'::regclass,
      'public.meta_ad_attributions'::regclass,
      'public.meta_conversion_events'::regclass
    )
    GROUP BY relrowsecurity
    HAVING relrowsecurity AND count(*) = 3
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on every Meta foundation table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pipeline_stages'
      AND column_name = 'meta_conversion_event'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'deals'
      AND column_name = 'meta_attribution_id'
  ) THEN
    RAISE EXCEPTION 'Meta columns on pipeline_stages/deals are missing';
  END IF;

  -- Four users give us owner/admin/viewer roles in Account A and an
  -- isolated owner in Account B. The signup trigger creates each
  -- user's profile and personal account.
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_owner_a, 'meta-owner-a@example.invalid', '{}'::jsonb),
    (v_admin_a, 'meta-admin-a@example.invalid', '{}'::jsonb),
    (v_viewer_a, 'meta-viewer-a@example.invalid', '{}'::jsonb),
    (v_owner_b, 'meta-owner-b@example.invalid', '{}'::jsonb);

  SELECT account_id INTO v_account_a FROM public.profiles WHERE user_id = v_owner_a;
  SELECT account_id INTO v_account_b FROM public.profiles WHERE user_id = v_owner_b;
  SELECT account_id INTO v_admin_personal_account FROM public.profiles WHERE user_id = v_admin_a;
  SELECT account_id INTO v_viewer_personal_account FROM public.profiles WHERE user_id = v_viewer_a;

  UPDATE public.profiles
  SET account_id = v_account_a, account_role = 'admin'
  WHERE user_id = v_admin_a;

  UPDATE public.profiles
  SET account_id = v_account_a, account_role = 'viewer'
  WHERE user_id = v_viewer_a;

  DELETE FROM public.accounts
  WHERE id IN (v_admin_personal_account, v_viewer_personal_account);

  INSERT INTO public.contacts (id, user_id, account_id, phone, name)
  VALUES
    (v_contact_a, v_owner_a, v_account_a, '+15550000001', 'Meta Contact A'),
    (v_contact_b, v_owner_b, v_account_b, '+15550000002', 'Meta Contact B');

  INSERT INTO public.conversations (id, user_id, account_id, contact_id)
  VALUES
    (v_conversation_a, v_owner_a, v_account_a, v_contact_a),
    (v_conversation_b, v_owner_b, v_account_b, v_contact_b);

  INSERT INTO public.whatsapp_config (
    id, user_id, account_id, phone_number_id, waba_id, access_token
  )
  VALUES
    (v_whatsapp_a, v_owner_a, v_account_a, 'phone-meta-a', 'waba-meta-a', 'cipher-wa-a'),
    (v_whatsapp_b, v_owner_b, v_account_b, 'phone-meta-b', 'waba-meta-b', 'cipher-wa-b');

  INSERT INTO public.meta_conversion_config (
    account_id, dataset_id, access_token, marketing_access_token
  )
  VALUES
    (v_account_a, 'dataset-a', 'cipher-capi-a', 'cipher-marketing-a'),
    (v_account_b, 'dataset-b', 'cipher-capi-b', 'cipher-marketing-b');

  INSERT INTO public.meta_ad_attributions (
    id, account_id, contact_id, conversation_id, whatsapp_config_id,
    ctwa_clid, waba_id, phone_number_id
  )
  VALUES
    (
      v_attribution_a, v_account_a, v_contact_a, v_conversation_a,
      v_whatsapp_a, 'ctwa-click-a', 'waba-meta-a', 'phone-meta-a'
    ),
    (
      v_attribution_b, v_account_b, v_contact_b, v_conversation_b,
      v_whatsapp_b, 'ctwa-click-b', 'waba-meta-b', 'phone-meta-b'
    );

  -- ctwa_clid replay is rejected, while distinct clicks remain valid.
  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, ctwa_clid)
    VALUES (v_account_a, 'ctwa-click-a');
    RAISE EXCEPTION 'duplicate ctwa_clid was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, enrichment_status, ctwa_clid)
    VALUES (v_account_a, 'unknown', 'ctwa-invalid-status');
    RAISE EXCEPTION 'invalid enrichment status was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Every attribution relationship is account-bound by composite FK.
  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, contact_id, ctwa_clid)
    VALUES (v_account_a, v_contact_b, 'ctwa-cross-contact');
    RAISE EXCEPTION 'cross-account attribution contact was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, conversation_id, ctwa_clid)
    VALUES (v_account_a, v_conversation_b, 'ctwa-cross-conversation');
    RAISE EXCEPTION 'cross-account attribution conversation was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, whatsapp_config_id, ctwa_clid)
    VALUES (v_account_a, v_whatsapp_b, 'ctwa-cross-config');
    RAISE EXCEPTION 'cross-account attribution config was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  -- Pipeline event values and per-pipeline uniqueness.
  INSERT INTO public.pipelines (id, user_id, account_id, name)
  VALUES
    (v_pipeline_a, v_owner_a, v_account_a, 'Meta Pipeline A'),
    (v_pipeline_b, v_owner_b, v_account_b, 'Meta Pipeline B');

  INSERT INTO public.pipeline_stages (
    id, pipeline_id, name, position, meta_conversion_event
  )
  VALUES
    (v_stage_none, v_pipeline_a, 'No event', 0, NULL),
    (v_stage_lead, v_pipeline_a, 'Lead', 1, 'LeadSubmitted'),
    (v_stage_qualified, v_pipeline_a, 'Qualified', 2, 'QualifiedLead'),
    (v_stage_purchase, v_pipeline_a, 'Purchase', 3, 'Purchase'),
    (v_stage_b, v_pipeline_b, 'Lead B', 0, 'LeadSubmitted');

  BEGIN
    INSERT INTO public.pipeline_stages (
      pipeline_id, name, position, meta_conversion_event
    ) VALUES (v_pipeline_a, 'Invalid', 4, 'Unknown');
    RAISE EXCEPTION 'invalid pipeline event was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.pipeline_stages (
      pipeline_id, name, position, meta_conversion_event
    ) VALUES (v_pipeline_a, 'Duplicate lead', 5, 'LeadSubmitted');
    RAISE EXCEPTION 'duplicate pipeline event was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO public.deals (
    id, user_id, account_id, pipeline_id, stage_id, title, meta_attribution_id
  )
  VALUES
    (
      v_deal_a, v_owner_a, v_account_a, v_pipeline_a, v_stage_lead,
      'Meta Deal A', v_attribution_a
    ),
    (
      v_deal_a_2, v_owner_a, v_account_a, v_pipeline_a, v_stage_none,
      'Meta Deal A2', v_attribution_a
    ),
    (
      v_deal_b, v_owner_b, v_account_b, v_pipeline_b, v_stage_b,
      'Meta Deal B', v_attribution_b
    );

  BEGIN
    UPDATE public.deals
    SET meta_attribution_id = v_attribution_b
    WHERE id = v_deal_a;
    RAISE EXCEPTION 'cross-account deal attribution was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  -- Valid event names, values and statuses.
  INSERT INTO public.meta_conversion_events (
    account_id, deal_id, contact_id, attribution_id, stage_id,
    event_name, event_id, event_time, value, currency, status
  )
  VALUES
    (
      v_account_a, v_deal_a, v_contact_a, v_attribution_a, v_stage_lead,
      'LeadSubmitted', 'event-a-lead', NOW(), NULL, NULL, 'pending'
    ),
    (
      v_account_a, v_deal_a, v_contact_a, v_attribution_a, v_stage_qualified,
      'QualifiedLead', 'event-a-qualified', NOW(), NULL, NULL, 'sent'
    ),
    (
      v_account_a, v_deal_a, v_contact_a, v_attribution_a, v_stage_purchase,
      'Purchase', 'event-a-purchase', NOW(), 125.50, 'USD', 'failed'
    ),
    (
      v_account_b, v_deal_b, v_contact_b, v_attribution_b, v_stage_b,
      'LeadSubmitted', 'event-b-lead', NOW(), NULL, NULL, 'pending'
    );

  FOREACH v_status IN ARRAY ARRAY[
    'skipped_disabled',
    'skipped_no_attribution',
    'skipped_missing_config'
  ]
  LOOP
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account_a,
      'LeadSubmitted',
      'event-a-' || v_status,
      NOW(),
      v_status
    );
  END LOOP;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, status
    ) VALUES (v_account_a, 'Unknown', 'event-invalid-name', NOW(), 'pending');
    RAISE EXCEPTION 'invalid event_name was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, status
    ) VALUES (v_account_a, 'LeadSubmitted', 'event-invalid-status', NOW(), 'unknown');
    RAISE EXCEPTION 'invalid event status was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, currency, status
    ) VALUES (v_account_a, 'LeadSubmitted', 'event-invalid-currency', NOW(), 'usd', 'pending');
    RAISE EXCEPTION 'invalid event currency was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, attempts, status
    ) VALUES (v_account_a, 'LeadSubmitted', 'event-negative-attempts', NOW(), -1, 'pending');
    RAISE EXCEPTION 'negative attempts was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, deal_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account_a, v_deal_a, 'LeadSubmitted', 'event-duplicate-deal-event',
      NOW(), 'pending'
    );
    RAISE EXCEPTION 'duplicate deal/event was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, deal_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account_a, v_deal_a_2, 'Purchase', 'event-a-lead', NOW(), 'pending'
    );
    RAISE EXCEPTION 'duplicate account/event_id was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, deal_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account_a, v_deal_b, 'QualifiedLead', 'event-cross-deal', NOW(), 'pending'
    );
    RAISE EXCEPTION 'cross-account event deal was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, stage_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account_a, v_stage_b, 'QualifiedLead', 'event-cross-stage', NOW(), 'pending'
    );
    RAISE EXCEPTION 'cross-account event stage was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Receiver snapshots cannot be rewritten after capture.
  BEGIN
    UPDATE public.meta_ad_attributions
    SET waba_id = 'wrong-waba'
    WHERE id = v_attribution_a;
    RAISE EXCEPTION 'attribution receiver snapshot was mutable' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Viewer A sees operational/audit data only in A and no config row.
  PERFORM set_config('request.jwt.claim.sub', v_viewer_a::text, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO v_count FROM public.meta_conversion_config;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'viewer can read Meta config rows';
  END IF;

  BEGIN
    PERFORM access_token FROM public.meta_conversion_config;
    RAISE EXCEPTION 'viewer can select config ciphertext' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.meta_ad_attributions WHERE account_id = v_account_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'viewer A can read Account B attribution';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.meta_conversion_events WHERE account_id = v_account_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'viewer A can read Account B event';
  END IF;

  BEGIN
    INSERT INTO public.meta_ad_attributions (account_id, ctwa_clid)
    VALUES (v_account_a, 'ctwa-viewer-write');
    RAISE EXCEPTION 'viewer can insert attribution' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  EXECUTE 'RESET ROLE';

  -- Admin A can read safe config metadata and update A, but never B or
  -- either ciphertext column through the browser role.
  PERFORM set_config('request.jwt.claim.sub', v_admin_a::text, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO v_count FROM public.meta_conversion_config;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin A config visibility is not account-scoped';
  END IF;

  UPDATE public.meta_conversion_config
  SET enabled = TRUE
  WHERE account_id = v_account_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin A could not update own config';
  END IF;

  BEGIN
    PERFORM access_token FROM public.meta_conversion_config;
    RAISE EXCEPTION 'admin browser can select config ciphertext' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  PERFORM set_config('request.jwt.claim.role', '', TRUE);

  -- Deleting mutable CRM entities must not delete Meta audit history.
  DELETE FROM public.contacts WHERE id = v_contact_a;
  DELETE FROM public.whatsapp_config WHERE id = v_whatsapp_a;
  DELETE FROM public.pipelines WHERE id = v_pipeline_a;

  SELECT count(*) INTO v_count
  FROM public.meta_ad_attributions
  WHERE id = v_attribution_a
    AND contact_id IS NULL
    AND conversation_id IS NULL
    AND whatsapp_config_id IS NULL
    AND waba_id = 'waba-meta-a'
    AND phone_number_id = 'phone-meta-a';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'attribution history/snapshots did not survive source deletion';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.meta_conversion_events
  WHERE account_id = v_account_a;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'event audit history was cascaded by CRM entity deletion';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_conversion_events
    WHERE account_id = v_account_a
      AND (deal_id IS NOT NULL OR contact_id IS NOT NULL OR stage_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'deleted CRM references were not nulled in event history';
  END IF;

  -- Remove smoke-test fixtures. Account deletion intentionally owns
  -- the only CASCADE boundary for all account-scoped Meta history.
  DELETE FROM public.accounts WHERE id IN (v_account_a, v_account_b);
  DELETE FROM auth.users WHERE id IN (v_owner_a, v_admin_a, v_viewer_a, v_owner_b);

  RAISE NOTICE 'Meta conversions foundation verification passed';
END
$$;
