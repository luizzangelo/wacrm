-- Daily first-response series for selectable dashboard ranges. Keep the
-- original weekly RPC intact for backwards compatibility.
CREATE FUNCTION public.dashboard_response_time_series(
  p_account_id UUID,
  p_range_days INTEGER DEFAULT 30,
  p_timezone TEXT DEFAULT 'America/Fortaleza',
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(
  day DATE,
  avg_minutes DOUBLE PRECISION,
  samples BIGINT,
  current_period_avg DOUBLE PRECISION,
  previous_period_avg DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  local_today DATE;
  current_start TIMESTAMPTZ;
  previous_start TIMESTAMPTZ;
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'invalid dashboard range' USING ERRCODE = '22023';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone
  ) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  local_today := (p_now AT TIME ZONE p_timezone)::DATE;
  current_start := (local_today - (p_range_days - 1))::TIMESTAMP
    AT TIME ZONE p_timezone;
  previous_start := (local_today - (p_range_days * 2 - 1))::TIMESTAMP
    AT TIME ZONE p_timezone;

  RETURN QUERY
  WITH eligible AS (
    SELECT c.id
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND EXISTS (
        SELECT 1
        FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND m.created_at >= previous_start
          AND m.created_at <= p_now
      )
  ), chronology AS (
    SELECT
      m.conversation_id,
      m.sender_type,
      m.created_at,
      count(*) FILTER (WHERE m.sender_type IN ('agent', 'bot')) OVER (
        PARTITION BY m.conversation_id
        ORDER BY m.created_at, m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS cycle
    FROM public.messages m
    JOIN eligible c ON c.id = m.conversation_id
    WHERE m.created_at <= p_now
      AND m.content_type NOT IN ('reaction', 'system')
      AND (
        m.sender_type = 'customer'
        OR (
          m.sender_type IN ('agent', 'bot')
          AND m.status IN ('sent', 'delivered', 'read')
        )
      )
  ), pairs AS (
    SELECT
      conversation_id,
      cycle,
      min(created_at) FILTER (WHERE sender_type = 'customer') AS inbound_at,
      min(created_at) FILTER (WHERE sender_type IN ('agent', 'bot')) AS reply_at
    FROM chronology
    GROUP BY conversation_id, cycle
  ), observations AS (
    SELECT
      (inbound_at AT TIME ZONE p_timezone)::DATE AS local_day,
      extract(epoch FROM (reply_at - inbound_at))::DOUBLE PRECISION / 60 AS minutes,
      inbound_at >= current_start AS current_period
    FROM pairs
    WHERE inbound_at >= previous_start
      AND reply_at >= inbound_at
  ), totals AS (
    SELECT
      avg(o.minutes) FILTER (WHERE o.current_period) AS current_avg,
      avg(o.minutes) FILTER (WHERE NOT o.current_period) AS previous_avg
    FROM observations o
  ), daily AS (
    SELECT o.local_day, avg(o.minutes) AS mean, count(*) AS n
    FROM observations o
    WHERE o.current_period
    GROUP BY o.local_day
  )
  SELECT
    d.local_day::DATE,
    b.mean,
    coalesce(b.n, 0),
    t.current_avg,
    t.previous_avg
  FROM generate_series(
    local_today - (p_range_days - 1),
    local_today,
    interval '1 day'
  ) AS d(local_day)
  CROSS JOIN totals t
  LEFT JOIN daily b ON b.local_day = d.local_day::DATE
  ORDER BY d.local_day;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_response_time_series(UUID, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_response_time_series(UUID, INTEGER, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;
