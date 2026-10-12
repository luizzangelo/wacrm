-- Aggregate the conversations chart in PostgreSQL so the Data API's default
-- 1,000-row response cap cannot truncate busy accounts. SECURITY INVOKER keeps
-- the existing messages/conversations RLS policies authoritative.
CREATE FUNCTION public.dashboard_conversation_series(
  p_account_id UUID,
  p_range_days INTEGER DEFAULT 30,
  p_timezone TEXT DEFAULT 'America/Fortaleza',
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(day DATE, incoming BIGINT, outgoing BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  local_today DATE;
  range_start DATE;
  start_at TIMESTAMPTZ;
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'invalid dashboard range' USING ERRCODE = '22023';
  END IF;

  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = p_timezone
  ) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  local_today := (p_now AT TIME ZONE p_timezone)::DATE;
  range_start := local_today - (p_range_days - 1);
  start_at := range_start::TIMESTAMP AT TIME ZONE p_timezone;

  RETURN QUERY
  WITH days AS (
    SELECT generated::DATE AS day
    FROM pg_catalog.generate_series(
      range_start::TIMESTAMP,
      local_today::TIMESTAMP,
      INTERVAL '1 day'
    ) AS generated
  ), totals AS (
    SELECT
      (m.created_at AT TIME ZONE p_timezone)::DATE AS day,
      count(*) FILTER (WHERE m.sender_type = 'customer') AS incoming,
      count(*) FILTER (WHERE m.sender_type <> 'customer') AS outgoing
    FROM public.messages AS m
    JOIN public.conversations AS c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND m.created_at >= start_at
      AND m.created_at <= p_now
    GROUP BY 1
  )
  SELECT
    d.day,
    coalesce(t.incoming, 0)::BIGINT,
    coalesce(t.outgoing, 0)::BIGINT
  FROM days AS d
  LEFT JOIN totals AS t USING (day)
  ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_conversation_series(UUID, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_conversation_series(UUID, INTEGER, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;
