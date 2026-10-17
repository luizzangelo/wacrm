BEGIN;

-- A stable key separates lifecycle tags managed by the CRM from arbitrary
-- user-created tags that happen to have a similar display name.
ALTER TABLE public.tags
  ADD COLUMN standard_stage_key TEXT;

ALTER TABLE public.tags
  ADD CONSTRAINT tags_standard_stage_key_check
  CHECK (standard_stage_key IS NULL OR standard_stage_key IN (
    'new_contact', 'lead', 'qualified_lead', 'disqualified_lead', 'customer'
  ));

CREATE UNIQUE INDEX tags_account_standard_stage_key_unique
  ON public.tags(account_id, standard_stage_key)
  WHERE standard_stage_key IS NOT NULL;

ALTER TABLE public.pipeline_stages
  ADD COLUMN automatic_tag_id UUID REFERENCES public.tags(id) ON DELETE SET NULL;

CREATE INDEX pipeline_stages_automatic_tag_id_idx
  ON public.pipeline_stages(automatic_tag_id)
  WHERE automatic_tag_id IS NOT NULL;

-- Reuse an existing same-name tag when possible, then create any missing
-- standard tag. This preserves customer data and avoids duplicate labels.
WITH candidates AS (
  SELECT DISTINCT ON (t.account_id, v.stage_key)
    t.id,
    v.stage_key
  FROM public.tags t
  CROSS JOIN (VALUES
    ('new_contact', 'Novo Contato'),
    ('lead', 'Lead'),
    ('qualified_lead', 'Lead Qualificado'),
    ('disqualified_lead', 'Lead Desqualificado'),
    ('customer', 'Cliente')
  ) AS v(stage_key, tag_name)
  WHERE LOWER(BTRIM(t.name)) = LOWER(v.tag_name)
    AND t.standard_stage_key IS NULL
  ORDER BY t.account_id, v.stage_key, t.created_at, t.id
)
UPDATE public.tags t
SET standard_stage_key = candidates.stage_key
FROM candidates
WHERE t.id = candidates.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.tags existing
    WHERE existing.account_id = t.account_id
      AND existing.standard_stage_key = candidates.stage_key
  );

INSERT INTO public.tags(account_id, user_id, name, color, standard_stage_key)
SELECT
  a.id,
  a.owner_user_id,
  v.tag_name,
  v.color,
  v.stage_key
FROM public.accounts a
CROSS JOIN (VALUES
  ('new_contact', 'Novo Contato', '#6366f1'),
  ('lead', 'Lead', '#3b82f6'),
  ('qualified_lead', 'Lead Qualificado', '#8b5cf6'),
  ('disqualified_lead', 'Lead Desqualificado', '#f59e0b'),
  ('customer', 'Cliente', '#22c55e')
) AS v(stage_key, tag_name, color)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tags t
  WHERE t.account_id = a.id
    AND t.standard_stage_key = v.stage_key
);

-- Rename only the exact untouched legacy five-stage template. Pipelines with
-- any customized name/count/order are intentionally left alone.
WITH legacy_pipelines AS (
  SELECT p.id
  FROM public.pipelines p
  JOIN public.pipeline_stages s
    ON s.pipeline_id = p.id
   AND NOT s.is_lost_stage
  GROUP BY p.id
  HAVING COUNT(*) = 5
     AND ARRAY_AGG(s.name ORDER BY s.position, s.id) = ARRAY[
       'New Lead', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won'
     ]::TEXT[]
)
UPDATE public.pipeline_stages s
SET name = CASE s.name
  WHEN 'New Lead' THEN 'Novo Contato'
  WHEN 'Qualified' THEN 'Lead'
  WHEN 'Proposal Sent' THEN 'Lead Qualificado'
  WHEN 'Negotiation' THEN 'Lead Desqualificado'
  WHEN 'Won' THEN 'Venda Ganha'
END
FROM legacy_pipelines p
WHERE s.pipeline_id = p.id
  AND NOT s.is_lost_stage;

-- Link only pipelines whose complete normal-stage sequence is the standard
-- funnel. A custom stage with the same isolated name is not opted in.
WITH standard_pipelines AS (
  SELECT p.id, p.account_id
  FROM public.pipelines p
  JOIN public.pipeline_stages s
    ON s.pipeline_id = p.id
   AND NOT s.is_lost_stage
  GROUP BY p.id, p.account_id
  HAVING COUNT(*) = 5
     AND ARRAY_AGG(s.name ORDER BY s.position, s.id) = ARRAY[
       'Novo Contato', 'Lead', 'Lead Qualificado', 'Lead Desqualificado', 'Venda Ganha'
     ]::TEXT[]
), stage_keys(stage_name, stage_key) AS (VALUES
  ('Novo Contato', 'new_contact'),
  ('Lead', 'lead'),
  ('Lead Qualificado', 'qualified_lead'),
  ('Lead Desqualificado', 'disqualified_lead'),
  ('Venda Ganha', 'customer')
)
UPDATE public.pipeline_stages s
SET automatic_tag_id = t.id
FROM standard_pipelines p
JOIN stage_keys k ON TRUE
JOIN public.tags t
  ON t.account_id = p.account_id
 AND t.standard_stage_key = k.stage_key
WHERE s.pipeline_id = p.id
  AND s.name = k.stage_name
  AND NOT s.is_lost_stage;

-- Future accounts receive the standard funnel and its automatic tags in the
-- same provisioning transaction used by signup.
CREATE OR REPLACE FUNCTION wacrm_private.provision_account_defaults(
  p_account UUID,
  p_user UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  pipeline UUID;
  new_contact_tag UUID;
  lead_tag UUID;
  qualified_tag UUID;
  disqualified_tag UUID;
  customer_tag UUID;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE account_id = p_account) THEN
    RETURN;
  END IF;

  INSERT INTO public.tags(account_id, user_id, name, color, standard_stage_key)
  VALUES
    (p_account, p_user, 'Novo Contato', '#6366f1', 'new_contact'),
    (p_account, p_user, 'Lead', '#3b82f6', 'lead'),
    (p_account, p_user, 'Lead Qualificado', '#8b5cf6', 'qualified_lead'),
    (p_account, p_user, 'Lead Desqualificado', '#f59e0b', 'disqualified_lead'),
    (p_account, p_user, 'Cliente', '#22c55e', 'customer')
  ON CONFLICT (account_id, standard_stage_key)
    WHERE standard_stage_key IS NOT NULL
  DO NOTHING;

  SELECT id INTO STRICT new_contact_tag FROM public.tags
    WHERE account_id = p_account AND standard_stage_key = 'new_contact';
  SELECT id INTO STRICT lead_tag FROM public.tags
    WHERE account_id = p_account AND standard_stage_key = 'lead';
  SELECT id INTO STRICT qualified_tag FROM public.tags
    WHERE account_id = p_account AND standard_stage_key = 'qualified_lead';
  SELECT id INTO STRICT disqualified_tag FROM public.tags
    WHERE account_id = p_account AND standard_stage_key = 'disqualified_lead';
  SELECT id INTO STRICT customer_tag FROM public.tags
    WHERE account_id = p_account AND standard_stage_key = 'customer';

  INSERT INTO public.pipelines(account_id, user_id, name, is_bootstrap)
    VALUES(p_account, p_user, 'Sales Pipeline', TRUE)
    RETURNING id INTO pipeline;

  INSERT INTO public.pipeline_stages(
    pipeline_id, name, color, position, meta_conversion_event, automatic_tag_id
  ) VALUES
    (pipeline, 'Novo Contato', '#6366f1', 0, NULL, new_contact_tag),
    (pipeline, 'Lead', '#3b82f6', 1, NULL, lead_tag),
    (pipeline, 'Lead Qualificado', '#8b5cf6', 2, NULL, qualified_tag),
    (pipeline, 'Lead Desqualificado', '#f59e0b', 3, NULL, disqualified_tag),
    (pipeline, 'Venda Ganha', '#22c55e', 4, NULL, customer_tag);
  -- Existing pipeline trigger creates the unmapped technical lost stage.
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.provision_account_defaults(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION wacrm_private.sync_deal_stage_tag()
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

  -- Custom/unmapped pipelines never modify lifecycle tags.
  IF target_tag IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.contact_tags ct
  USING public.tags t
  WHERE ct.contact_id = NEW.contact_id
    AND ct.tag_id = t.id
    AND t.account_id = NEW.account_id
    AND t.standard_stage_key IS NOT NULL
    AND ct.tag_id <> target_tag;

  INSERT INTO public.contact_tags(contact_id, tag_id)
  VALUES(NEW.contact_id, target_tag)
  ON CONFLICT (contact_id, tag_id) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.sync_deal_stage_tag()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_deal_stage_tag
AFTER INSERT OR UPDATE OF stage_id, contact_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION wacrm_private.sync_deal_stage_tag();

-- Bring existing contacts in a standard funnel to the tag matching their most
-- recently updated deal. Manual/non-standard tags are never removed.
WITH current_deals AS (
  SELECT DISTINCT ON (d.account_id, d.contact_id)
    d.id,
    d.account_id,
    d.contact_id,
    s.automatic_tag_id
  FROM public.deals d
  JOIN public.pipeline_stages s
    ON s.id = d.stage_id
   AND s.pipeline_id = d.pipeline_id
  WHERE d.contact_id IS NOT NULL
    AND s.automatic_tag_id IS NOT NULL
  ORDER BY d.account_id, d.contact_id, d.updated_at DESC NULLS LAST,
    d.created_at DESC, d.id DESC
), remove_stale AS (
  DELETE FROM public.contact_tags ct
  USING current_deals d, public.tags t
  WHERE ct.contact_id = d.contact_id
    AND ct.tag_id = t.id
    AND t.account_id = d.account_id
    AND t.standard_stage_key IS NOT NULL
    AND ct.tag_id <> d.automatic_tag_id
  RETURNING ct.id
)
INSERT INTO public.contact_tags(contact_id, tag_id)
SELECT contact_id, automatic_tag_id
FROM current_deals
ON CONFLICT (contact_id, tag_id) DO NOTHING;

COMMIT;
