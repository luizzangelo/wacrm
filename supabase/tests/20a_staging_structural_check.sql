-- STAGING ONLY. No permanent fixtures, no mapped moves, no cron/HTTP.
-- An explicit subtransaction rollback removes every created pipeline/stage/deal.
DO $$
DECLARE
  v_account UUID; v_actor UUID; v_contact UUID; v_attribution UUID;
  v_pipeline UUID; v_empty_pipeline UUID; v_normal UUID; v_lost UUID;
  v_foreign_stage UUID; v_deal public.deals%ROWTYPE;
  v_result JSONB; v_before JSONB; v_after JSONB; v_summary JSONB;
  v_no_normal_rejected BOOLEAN := FALSE;
BEGIN
  SELECT account_id INTO STRICT v_account FROM public.meta_conversion_config
    WHERE dataset_id = '2000316380612611';
  SELECT user_id INTO v_actor FROM public.pipelines WHERE account_id=v_account LIMIT 1;
  SELECT id,contact_id INTO v_attribution,v_contact FROM public.meta_ad_attributions
    WHERE account_id=v_account AND contact_id IS NOT NULL
    ORDER BY received_at DESC,id DESC LIMIT 1;
  IF v_actor IS NULL OR v_contact IS NULL THEN RAISE EXCEPTION 'missing staging context'; END IF;
  SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) INTO v_before FROM public.meta_conversion_events e;
  IF EXISTS (SELECT 1 FROM public.meta_conversion_events WHERE status IN ('pending','sending')) THEN
    RAISE EXCEPTION 'queue must be empty for structural test';
  END IF;

  BEGIN
    INSERT INTO public.pipelines(account_id,user_id,name)
      VALUES (v_account,v_actor,'TESTE ESTRUTURAL 20A ROLLBACK') RETURNING id INTO v_pipeline;
    SELECT id INTO STRICT v_lost FROM public.pipeline_stages
      WHERE pipeline_id=v_pipeline AND is_lost_stage;
    INSERT INTO public.pipeline_stages(pipeline_id,name,position,meta_conversion_event)
      VALUES(v_pipeline,'Inicial estrutural',0,NULL) RETURNING id INTO v_normal;
    SELECT id INTO v_foreign_stage FROM public.pipeline_stages
      WHERE pipeline_id<>v_pipeline AND is_lost_stage LIMIT 1;

    INSERT INTO public.deals(account_id,user_id,pipeline_id,contact_id,stage_id,title)
      VALUES(v_account,v_actor,v_pipeline,v_contact,v_foreign_stage,'ignored title')
      RETURNING * INTO v_deal;
    IF v_deal.stage_id<>v_normal OR v_deal.status<>'open' OR
      v_deal.title IS DISTINCT FROM (SELECT name FROM public.contacts WHERE id=v_contact) THEN
      RAISE EXCEPTION 'initial stage/title invariant failed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id=v_lost AND
      (position<=0 OR meta_conversion_event IS NOT NULL)) THEN
      RAISE EXCEPTION 'loss ordering/mapping invariant failed';
    END IF;
    UPDATE public.deals SET meta_attribution_id=v_attribution WHERE id=v_deal.id;

    v_result := public.move_deal_to_stage_with_conversion_intent(v_account,v_deal.id,v_lost);
    IF v_result->>'error' IS DISTINCT FROM 'lost_reason_required' OR
      (SELECT stage_id FROM public.deals WHERE id=v_deal.id)<>v_normal THEN
      RAISE EXCEPTION 'missing reason was not rejected before write';
    END IF;
    v_result := public.move_deal_to_stage_with_conversion_intent(v_account,v_deal.id,v_lost,'other','Nota estrutural');
    IF v_result->>'ok'<>'true' OR v_result->'deal'->>'status'<>'lost' OR
      v_result->'deal'->>'lost_reason'<>'other' OR
      v_result->>'conversionEventCreated'<>'false' THEN
      RAISE EXCEPTION 'atomic loss invariant failed';
    END IF;
    v_result := public.move_deal_to_stage_with_conversion_intent(v_account,v_deal.id,v_lost,'price','Histórico estrutural');
    IF v_result->>'ok'<>'true' OR v_result->'deal'->>'lost_reason'<>'price' OR
      v_result->>'conversionEventCreated'<>'false' THEN
      RAISE EXCEPTION 'same-stage reason editing failed';
    END IF;
    v_result := public.move_deal_to_stage_with_conversion_intent(v_account,v_deal.id,v_normal);
    IF v_result->>'ok'<>'true' OR v_result->'deal'->>'status'<>'open' OR
      v_result->'deal'->>'lost_reason'<>'price' OR
      v_result->'deal'->>'meta_attribution_id'<>v_attribution::TEXT OR
      v_result->>'conversionEventCreated'<>'false' THEN
      RAISE EXCEPTION 'reopening/frozen attribution invariant failed';
    END IF;
    v_result := public.move_deal_to_stage_with_conversion_intent(v_account,v_deal.id,v_foreign_stage,'other');
    IF v_result->>'error' IS DISTINCT FROM 'stage_not_available' THEN
      RAISE EXCEPTION 'other pipeline was not rejected';
    END IF;

    INSERT INTO public.pipelines(account_id,user_id,name)
      VALUES(v_account,v_actor,'TESTE SEM STAGE NORMAL 20A ROLLBACK')
      RETURNING id INTO v_empty_pipeline;
    BEGIN
      INSERT INTO public.deals(account_id,user_id,pipeline_id,contact_id)
        VALUES(v_account,v_actor,v_empty_pipeline,v_contact);
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'pipeline_has_no_normal_stage' THEN RAISE; END IF;
      v_no_normal_rejected:=TRUE;
    END;
    IF NOT v_no_normal_rejected THEN RAISE EXCEPTION 'empty normal stages must reject creation'; END IF;
    SET CONSTRAINTS ALL IMMEDIATE;
    SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) INTO v_after FROM public.meta_conversion_events e;
    IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'historical events changed'; END IF;
    v_summary := jsonb_build_object('new_pipeline_auto_lost',TRUE,
      'first_normal_enforced',TRUE,'contact_title_enforced',TRUE,
      'loss_without_reason_rejected',TRUE,'loss_confirm_atomic',TRUE,
      'same_stage_reason_edit',TRUE,'reopening',TRUE,'freeze_preserved',TRUE,
      'other_pipeline_rejected',TRUE,'no_normal_stage_rejected',TRUE,
      'new_conversion_events',0,'historical_events_unchanged',TRUE,
      'all_fixtures_rolled_back',TRUE);
    RAISE EXCEPTION 'rollback structural fixtures' USING ERRCODE='W20A0';
  EXCEPTION WHEN SQLSTATE 'W20A0' THEN
    -- PL/pgSQL rolls back inner writes; variable values survive the rollback.
    PERFORM set_config('wacrm20a.structural_result',v_summary::TEXT,TRUE);
  END;
END $$;
SELECT current_setting('wacrm20a.structural_result')::JSONB AS result;
