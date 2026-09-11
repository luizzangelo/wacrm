-- ============================================================
-- 040_meta_conversions_foundation
--
-- Database-only foundation for Meta Conversions API for Business
-- Messaging. No webhook ingestion, Meta API calls, UI, or workers.
--
-- The new records are account-scoped. Composite foreign keys bind
-- each related id to the same account_id, so tenant isolation does
-- not depend on application code or RLS alone. Audit references use
-- ON DELETE SET NULL while their account-owned history survives.
-- ============================================================

-- Composite foreign keys below need a matching non-partial unique
-- index on each referenced (id, account_id) pair. The id is already
-- globally unique; these explicit pairs exist solely to make account
-- equality enforceable by PostgreSQL foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_id_account
  ON public.contacts(id, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_id_account
  ON public.conversations(id, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_id_account
  ON public.whatsapp_config(id, account_id);

-- ============================================================
-- META CONVERSION CONFIG
--
-- One row per account. Tokens will contain reversible AES-256-GCM
-- ciphertext once the future server-side settings API is built.
-- Nullable credentials allow a disabled/incomplete configuration to
-- be saved without placeholder secrets.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_conversion_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  dataset_id TEXT,
  access_token TEXT,
  marketing_access_token TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_conversion_config_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE,
  CONSTRAINT meta_conversion_config_account_id_key UNIQUE (account_id)
);

COMMENT ON TABLE public.meta_conversion_config IS
  'Server-managed Meta Conversions configuration. Token columns contain ciphertext and are not selectable by browser roles.';

COMMENT ON COLUMN public.meta_conversion_config.access_token IS
  'Reversible AES-256-GCM ciphertext; never plaintext and never returned to browser clients.';

COMMENT ON COLUMN public.meta_conversion_config.marketing_access_token IS
  'Optional reversible AES-256-GCM ciphertext for future Marketing API enrichment.';

-- ============================================================
-- META AD ATTRIBUTIONS
--
-- One immutable click identity per account. contact_id is nullable
-- intentionally: deleting a contact must not erase attribution
-- history. The WABA and phone-number snapshots preserve the original
-- receiver even if whatsapp_config is later replaced or deleted.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_ad_attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  contact_id UUID,
  conversation_id UUID,
  whatsapp_config_id UUID,
  whatsapp_message_id TEXT,
  ctwa_clid TEXT NOT NULL,
  source_id TEXT,
  source_type TEXT,
  source_url TEXT,
  referral_headline TEXT,
  referral_body TEXT,
  media_type TEXT,
  image_url TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  waba_id TEXT,
  phone_number_id TEXT,
  ad_id TEXT,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  enrichment_error TEXT,
  enriched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_ad_attributions_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE,
  CONSTRAINT meta_ad_attributions_contact_account_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts(id, account_id)
    ON DELETE SET NULL (contact_id),
  CONSTRAINT meta_ad_attributions_conversation_account_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES public.conversations(id, account_id)
    ON DELETE SET NULL (conversation_id),
  CONSTRAINT meta_ad_attributions_whatsapp_config_account_fkey
    FOREIGN KEY (whatsapp_config_id, account_id)
    REFERENCES public.whatsapp_config(id, account_id)
    ON DELETE SET NULL (whatsapp_config_id),
  CONSTRAINT meta_ad_attributions_account_ctwa_clid_key
    UNIQUE (account_id, ctwa_clid),
  CONSTRAINT meta_ad_attributions_enrichment_status_check
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed'))
);

COMMENT ON COLUMN public.meta_ad_attributions.ctwa_clid IS
  'Meta click identifier. Meta documents it as unique per click; account-scoped uniqueness rejects webhook replays.';

COMMENT ON COLUMN public.meta_ad_attributions.waba_id IS
  'Immutable snapshot of the WABA that received the original CTWA click.';

COMMENT ON COLUMN public.meta_ad_attributions.phone_number_id IS
  'Immutable snapshot of the WhatsApp number that received the original CTWA click.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ad_attributions_id_account
  ON public.meta_ad_attributions(id, account_id);

CREATE INDEX IF NOT EXISTS idx_meta_ad_attributions_account_contact_received
  ON public.meta_ad_attributions(account_id, contact_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_ad_attributions_account_conversation
  ON public.meta_ad_attributions(account_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_ad_attributions_account_whatsapp_config
  ON public.meta_ad_attributions(account_id, whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_ad_attributions_account_source
  ON public.meta_ad_attributions(account_id, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_ad_attributions_account_received
  ON public.meta_ad_attributions(account_id, received_at DESC);

-- Snapshot identity is write-once. Enrichment and relational links may
-- still be updated later by the webhook/enrichment services.
CREATE OR REPLACE FUNCTION public.protect_meta_ad_attribution_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.ctwa_clid IS DISTINCT FROM OLD.ctwa_clid
    OR NEW.waba_id IS DISTINCT FROM OLD.waba_id
    OR NEW.phone_number_id IS DISTINCT FROM OLD.phone_number_id
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
  THEN
    RAISE EXCEPTION 'Meta attribution click identity and receiver snapshots are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_meta_ad_attribution_identity
  ON public.meta_ad_attributions;
CREATE TRIGGER protect_meta_ad_attribution_identity
  BEFORE UPDATE ON public.meta_ad_attributions
  FOR EACH ROW EXECUTE FUNCTION public.protect_meta_ad_attribution_identity();

-- ============================================================
-- PIPELINE STAGES
-- ============================================================
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS meta_conversion_event TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_meta_conversion_event_check'
      AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE public.pipeline_stages
      ADD CONSTRAINT pipeline_stages_meta_conversion_event_check
      CHECK (
        meta_conversion_event IS NULL
        OR meta_conversion_event IN ('LeadSubmitted', 'QualifiedLead', 'Purchase')
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_meta_conversion_event
  ON public.pipeline_stages(pipeline_id, meta_conversion_event)
  WHERE meta_conversion_event IS NOT NULL;

-- ============================================================
-- DEAL ATTRIBUTION SNAPSHOT
-- ============================================================
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS meta_attribution_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_id_account
  ON public.deals(id, account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deals_meta_attribution_account_fkey'
      AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_meta_attribution_account_fkey
      FOREIGN KEY (meta_attribution_id, account_id)
      REFERENCES public.meta_ad_attributions(id, account_id)
      ON DELETE SET NULL (meta_attribution_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_deals_account_meta_attribution
  ON public.deals(account_id, meta_attribution_id)
  WHERE meta_attribution_id IS NOT NULL;

-- ============================================================
-- META CONVERSION EVENTS
--
-- Durable audit/outbox rows. Entity references become NULL when their
-- source is deleted, but event snapshots and delivery outcome remain.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_conversion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  deal_id UUID,
  contact_id UUID,
  attribution_id UUID,
  stage_id UUID,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  value NUMERIC(12,2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  meta_http_status INTEGER,
  meta_response JSONB,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_conversion_events_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE,
  CONSTRAINT meta_conversion_events_deal_account_fkey
    FOREIGN KEY (deal_id, account_id)
    REFERENCES public.deals(id, account_id)
    ON DELETE SET NULL (deal_id),
  CONSTRAINT meta_conversion_events_contact_account_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts(id, account_id)
    ON DELETE SET NULL (contact_id),
  CONSTRAINT meta_conversion_events_attribution_account_fkey
    FOREIGN KEY (attribution_id, account_id)
    REFERENCES public.meta_ad_attributions(id, account_id)
    ON DELETE SET NULL (attribution_id),
  CONSTRAINT meta_conversion_events_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  CONSTRAINT meta_conversion_events_event_name_check
    CHECK (event_name IN ('LeadSubmitted', 'QualifiedLead', 'Purchase')),
  CONSTRAINT meta_conversion_events_status_check
    CHECK (
      status IN (
        'pending',
        'sent',
        'failed',
        'skipped_disabled',
        'skipped_no_attribution',
        'skipped_missing_config'
      )
    ),
  CONSTRAINT meta_conversion_events_attempts_check CHECK (attempts >= 0),
  CONSTRAINT meta_conversion_events_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT meta_conversion_events_account_event_id_key
    UNIQUE (account_id, event_id)
);

-- While a deal exists, one row per conversion milestone. deal_id is
-- nullable so deleting the deal preserves the historical event row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_conversion_events_account_deal_event
  ON public.meta_conversion_events(account_id, deal_id, event_name)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_account_status_created
  ON public.meta_conversion_events(account_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_account_event_created
  ON public.meta_conversion_events(account_id, event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_account_created
  ON public.meta_conversion_events(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_account_contact
  ON public.meta_conversion_events(account_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_account_attribution
  ON public.meta_conversion_events(account_id, attribution_id)
  WHERE attribution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_stage
  ON public.meta_conversion_events(stage_id)
  WHERE stage_id IS NOT NULL;

-- pipeline_stages does not carry account_id directly; its account is
-- derived through pipelines. Validate that final indirect relationship
-- on every event write. All other tenant relationships above are
-- enforced declaratively by composite foreign keys.
CREATE OR REPLACE FUNCTION public.validate_meta_conversion_event_stage_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = NEW.stage_id
      AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Meta conversion event stage must belong to the same account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_meta_conversion_event_stage_account
  ON public.meta_conversion_events;
CREATE TRIGGER validate_meta_conversion_event_stage_account
  BEFORE INSERT OR UPDATE OF account_id, stage_id
  ON public.meta_conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_meta_conversion_event_stage_account();

-- ============================================================
-- UPDATED_AT
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at ON public.meta_conversion_config;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meta_conversion_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_ad_attributions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meta_ad_attributions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_conversion_events;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meta_conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS AND DATA API PRIVILEGES
-- ============================================================
ALTER TABLE public.meta_conversion_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_conversion_config_select ON public.meta_conversion_config;
DROP POLICY IF EXISTS meta_conversion_config_insert ON public.meta_conversion_config;
DROP POLICY IF EXISTS meta_conversion_config_update ON public.meta_conversion_config;
DROP POLICY IF EXISTS meta_conversion_config_delete ON public.meta_conversion_config;

-- Admins need a SELECT policy for UPDATE to work, but column grants
-- below expose only non-secret metadata. Ciphertext stays unavailable
-- even to a direct browser query using the authenticated role.
CREATE POLICY meta_conversion_config_select
  ON public.meta_conversion_config FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY meta_conversion_config_insert
  ON public.meta_conversion_config FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE POLICY meta_conversion_config_update
  ON public.meta_conversion_config FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE POLICY meta_conversion_config_delete
  ON public.meta_conversion_config FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_ad_attributions_select ON public.meta_ad_attributions;
DROP POLICY IF EXISTS meta_ad_attributions_insert ON public.meta_ad_attributions;
DROP POLICY IF EXISTS meta_ad_attributions_update ON public.meta_ad_attributions;

CREATE POLICY meta_ad_attributions_select
  ON public.meta_ad_attributions FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

CREATE POLICY meta_ad_attributions_insert
  ON public.meta_ad_attributions FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY meta_ad_attributions_update
  ON public.meta_ad_attributions FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS meta_conversion_events_select ON public.meta_conversion_events;

-- Audit/outbox writes are service-role only. Members may inspect their
-- own account's history, but no browser role can mutate or delete it.
CREATE POLICY meta_conversion_events_select
  ON public.meta_conversion_events FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

REVOKE ALL PRIVILEGES ON TABLE public.meta_conversion_config
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.meta_ad_attributions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.meta_conversion_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, account_id, dataset_id, enabled, created_at, updated_at)
  ON TABLE public.meta_conversion_config TO authenticated;
GRANT INSERT (account_id, dataset_id, access_token, marketing_access_token, enabled)
  ON TABLE public.meta_conversion_config TO authenticated;
GRANT UPDATE (dataset_id, access_token, marketing_access_token, enabled)
  ON TABLE public.meta_conversion_config TO authenticated;
GRANT DELETE ON TABLE public.meta_conversion_config TO authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.meta_ad_attributions TO authenticated;

GRANT SELECT ON TABLE public.meta_conversion_events TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.meta_conversion_config,
  public.meta_ad_attributions,
  public.meta_conversion_events
  TO service_role;

-- Trigger functions are implementation details, not public RPCs.
REVOKE ALL ON FUNCTION public.protect_meta_ad_attribution_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_meta_ad_attribution_identity() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_meta_conversion_event_stage_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_meta_conversion_event_stage_account() FROM anon, authenticated;
