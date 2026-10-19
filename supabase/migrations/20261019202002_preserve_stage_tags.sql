BEGIN;

-- Lifecycle tags are cumulative history markers. Moving a deal to a new
-- stage adds that stage's tag without deleting tags earned in earlier stages.
CREATE OR REPLACE FUNCTION wacrm_private.sync_deal_stage_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_tag UUID;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.automatic_tag_id
    INTO target_tag
  FROM public.pipeline_stages s
  JOIN public.pipelines p
    ON p.id = s.pipeline_id
   AND p.account_id = NEW.account_id
  JOIN public.tags t
    ON t.id = s.automatic_tag_id
   AND t.account_id = NEW.account_id
  WHERE s.id = NEW.stage_id
    AND s.pipeline_id = NEW.pipeline_id;

  IF target_tag IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.contact_tags(contact_id, tag_id)
  VALUES(NEW.contact_id, target_tag)
  ON CONFLICT (contact_id, tag_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION wacrm_private.sync_deal_stage_tag()
  FROM PUBLIC, anon, authenticated;

COMMIT;
