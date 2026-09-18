-- Local preparation only: do not apply to production without rollout approval.
-- Confirmed relationship: profiles.user_id UNIQUE REFERENCES auth.users(id).
-- auth admin role cannot update the RLS-protected public profile directly;
-- this narrowly privileged, non-exposed trigger bridges that boundary.
CREATE OR REPLACE FUNCTION wacrm_private.sync_auth_email_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'auth' OR TG_TABLE_NAME <> 'users' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Invalid email synchronization trigger context'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
    SET email = COALESCE(NEW.email, '')
    WHERE user_id = NEW.id
      AND email IS DISTINCT FROM COALESCE(NEW.email, '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.sync_auth_email_to_profile()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_auth_email_to_profile ON auth.users;
CREATE TRIGGER sync_auth_email_to_profile
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION wacrm_private.sync_auth_email_to_profile();

-- Reconcile only the existing copy, never insert a profile or change membership.
-- IS DISTINCT FROM makes both reconciliation and repeated execution no-ops
-- when already synchronized. NOT NULL profiles.email maps NULL Auth email to ''.
UPDATE public.profiles p
  SET email = COALESCE(u.email, '')
  FROM auth.users u
  WHERE p.user_id = u.id
    AND p.email IS DISTINCT FROM COALESCE(u.email, '');
