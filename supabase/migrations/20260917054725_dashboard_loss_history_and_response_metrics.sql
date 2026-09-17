-- Immutable loss occurrences, not a snapshot of currently lost deals.
-- No backfill: updated_at cannot establish historical loss timestamps.
-- Deal/pipeline/stage UUIDs are snapshots (no cascading deletion of history).
CREATE TABLE public.deal_loss_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  lost_stage_id UUID NOT NULL,
  lost_reason TEXT NOT NULL CHECK (lost_reason IN (
    'price','no_interest','no_budget','no_response','competitor',
    'unavailable','bad_timing','unqualified','other'
  )),
  lost_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX deal_loss_events_account_time ON public.deal_loss_events(account_id,lost_at)
  INCLUDE (lost_reason);
ALTER TABLE public.deal_loss_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY loss_events_read ON public.deal_loss_events FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
REVOKE ALL ON public.deal_loss_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.deal_loss_events TO authenticated;
GRANT SELECT, INSERT ON public.deal_loss_events TO service_role;

CREATE FUNCTION public.record_deal_loss_occurrence() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Existing lifecycle guard validates reason, tenant and stage. This AFTER
  -- trigger participates in the same transaction; retries/reason edits do not
  -- constitute a transition. Reopening never erases or changes an occurrence.
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.status = 'lost'
     AND OLD.status IS DISTINCT FROM 'lost'
     AND EXISTS (SELECT 1 FROM public.pipeline_stages s
                 WHERE s.id=NEW.stage_id AND s.pipeline_id=NEW.pipeline_id AND s.is_lost_stage) THEN
    INSERT INTO public.deal_loss_events(account_id,deal_id,pipeline_id,lost_stage_id,lost_reason)
    VALUES (NEW.account_id,NEW.id,NEW.pipeline_id,NEW.stage_id,NEW.lost_reason);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_deal_loss_occurrence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER record_deal_loss_occurrence AFTER UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.record_deal_loss_occurrence();

-- RLS + explicit account predicate; nine bounded aggregates, never PII.
CREATE FUNCTION public.dashboard_loss_reasons(
  p_account_id UUID, p_period TEXT DEFAULT 'month',
  p_timezone TEXT DEFAULT 'America/Fortaleza', p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(reason TEXT, count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE local_now TIMESTAMP; period_start TIMESTAMPTZ;
BEGIN
  IF p_period IS NULL OR p_period NOT IN ('day','week','month') THEN
    RAISE EXCEPTION 'invalid dashboard period' USING ERRCODE='22023';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE='22023';
  END IF;
  local_now := p_now AT TIME ZONE p_timezone;
  period_start := (CASE p_period
    WHEN 'day' THEN date_trunc('day',local_now)
    WHEN 'week' THEN date_trunc('day',local_now) - extract(dow FROM local_now)::int * interval '1 day'
    ELSE date_trunc('month',local_now)
  END) AT TIME ZONE p_timezone;
  RETURN QUERY
  WITH reasons AS (
    SELECT r.code, r.ordinal FROM unnest(ARRAY[
      'price','no_interest','no_budget','no_response','competitor',
      'unavailable','bad_timing','unqualified','other'
    ]) WITH ORDINALITY r(code,ordinal)
  ), totals AS (
    SELECT e.lost_reason, count(*) total FROM public.deal_loss_events e
    WHERE e.account_id=p_account_id AND e.lost_at>=period_start AND e.lost_at<=p_now
    GROUP BY e.lost_reason
  )
  SELECT r.code,coalesce(t.total,0) FROM reasons r LEFT JOIN totals t ON t.lost_reason=r.code ORDER BY r.ordinal;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_loss_reasons(UUID,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_loss_reasons(UUID,TEXT,TEXT,TIMESTAMPTZ) TO authenticated, service_role;

-- Minutes throughout. Pair each unanswered inbound burst with its first
-- successfully dispatched agent/bot reply. Failed/unsent messages and reactions
-- cannot answer a customer. Keep pre-window context to avoid clipping a burst.
CREATE FUNCTION public.dashboard_response_time(
  p_account_id UUID, p_timezone TEXT DEFAULT 'America/Fortaleza', p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(dow INTEGER, avg_minutes DOUBLE PRECISION, samples BIGINT,
                this_week_avg DOUBLE PRECISION, last_week_avg DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE local_now TIMESTAMP; week_start TIMESTAMPTZ; previous_start TIMESTAMPTZ;
BEGIN
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE='22023';
  END IF;
  local_now := p_now AT TIME ZONE p_timezone;
  week_start := (date_trunc('day',local_now) - extract(dow FROM local_now)::int * interval '1 day') AT TIME ZONE p_timezone;
  previous_start := ((week_start AT TIME ZONE p_timezone)-interval '7 days') AT TIME ZONE p_timezone;
  RETURN QUERY
  WITH eligible AS (
    SELECT c.id FROM public.conversations c WHERE c.account_id=p_account_id
    AND EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id
      AND m.sender_type='customer' AND m.created_at>=previous_start AND m.created_at<=p_now)
  ), chronology AS (
    SELECT m.conversation_id,m.sender_type,m.created_at,
      count(*) FILTER(WHERE m.sender_type IN ('agent','bot')) OVER(
        PARTITION BY m.conversation_id ORDER BY m.created_at,m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) cycle
    FROM public.messages m JOIN eligible c ON c.id=m.conversation_id
    WHERE m.created_at<=p_now AND m.content_type NOT IN ('reaction','system')
      AND (m.sender_type='customer' OR
        (m.sender_type IN ('agent','bot') AND m.status IN ('sent','delivered','read')))
  ), pairs AS (
    SELECT conversation_id,cycle,
      min(created_at) FILTER(WHERE sender_type='customer') inbound_at,
      min(created_at) FILTER(WHERE sender_type IN ('agent','bot')) reply_at
    FROM chronology GROUP BY conversation_id,cycle
  ), observations AS (
    SELECT extract(dow FROM inbound_at AT TIME ZONE p_timezone)::int weekday,
      extract(epoch FROM(reply_at-inbound_at))::double precision/60 minutes,
      inbound_at>=week_start current_week
    FROM pairs WHERE inbound_at>=previous_start AND reply_at>=inbound_at
  ), totals AS (
    SELECT avg(o.minutes) FILTER(WHERE o.current_week) current_avg,
      avg(o.minutes) FILTER(WHERE NOT o.current_week) previous_avg FROM observations o
  ), daily AS (
    SELECT o.weekday,avg(o.minutes) mean,count(*) n FROM observations o WHERE o.current_week GROUP BY o.weekday
  )
  SELECT d.weekday,b.mean,coalesce(b.n,0),t.current_avg,t.previous_avg
  FROM generate_series(0,6) d(weekday) CROSS JOIN totals t LEFT JOIN daily b ON b.weekday=d.weekday ORDER BY d.weekday;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_response_time(UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_response_time(UUID,TEXT,TIMESTAMPTZ) TO authenticated, service_role;
