-- Functional verification for 042_meta_conversion_delivery_certainty.sql.
-- Keep this as exactly one statement: `supabase db query --file` sends
-- the file as a prepared statement and rejects multiple top-level commands.
DO $$
DECLARE
  v_owner UUID := uuid_generate_v4();
  v_account UUID;
  v_status TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.meta_conversion_events'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on meta_conversion_events';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.meta_conversion_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.meta_conversion_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.meta_conversion_events', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.meta_conversion_events', 'DELETE')
  THEN
    RAISE EXCEPTION 'authenticated grants on meta_conversion_events changed';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.meta_conversion_events', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.meta_conversion_events', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.meta_conversion_events', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.meta_conversion_events', 'DELETE')
  THEN
    RAISE EXCEPTION 'service_role grants on meta_conversion_events changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'public.meta_conversion_events'::regclass
      AND polname = 'meta_conversion_events_select'
      AND polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'event audit SELECT policy is missing';
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_owner, 'meta-delivery-certainty@example.invalid', '{}'::jsonb);

  SELECT account_id INTO v_account
  FROM public.profiles
  WHERE user_id = v_owner;

  -- Both new states and every status accepted before 042 remain valid.
  FOREACH v_status IN ARRAY ARRAY[
    'pending',
    'sending',
    'sent',
    'failed',
    'delivery_unknown',
    'skipped_disabled',
    'skipped_no_attribution',
    'skipped_missing_config'
  ]
  LOOP
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account,
      'LeadSubmitted',
      'delivery-certainty-' || v_status,
      NOW(),
      v_status
    );
  END LOOP;

  BEGIN
    INSERT INTO public.meta_conversion_events (
      account_id, event_name, event_id, event_time, status
    ) VALUES (
      v_account, 'LeadSubmitted', 'delivery-certainty-invalid', NOW(), 'unknown'
    );
    RAISE EXCEPTION 'invalid event status was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  DELETE FROM public.accounts WHERE id = v_account;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'Meta conversion delivery certainty verification passed';
END
$$;
