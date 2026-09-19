-- Deferred constraint triggers run at COMMIT under the transaction role.
-- Supabase Auth commits signup as supabase_auth_admin, which intentionally has
-- no broad read access to tenant tables. Keep that least-privilege boundary and
-- run only this narrow invariant check with its trusted owner privileges.
CREATE OR REPLACE FUNCTION public.require_pipeline_lost_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pipeline uuid;
BEGIN
  IF TG_TABLE_NAME = 'pipelines' THEN
    pipeline := NEW.id;
  ELSE
    pipeline := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id
      ELSE NEW.pipeline_id
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pipelines
    WHERE id = pipeline
  ) AND (
    SELECT count(*)
    FROM public.pipeline_stages
    WHERE pipeline_id = pipeline
      AND is_lost_stage
  ) <> 1 THEN
    RAISE EXCEPTION 'pipeline_requires_one_lost_stage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

ALTER FUNCTION public.require_pipeline_lost_stage() OWNER TO postgres;

-- Trigger execution does not require callers to invoke the function directly.
-- Preserve the pre-existing service_role ACL, but expose no new callable API.
REVOKE ALL ON FUNCTION public.require_pipeline_lost_stage()
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
