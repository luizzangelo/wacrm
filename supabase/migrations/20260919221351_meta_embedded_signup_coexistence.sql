-- Meta WhatsApp Embedded Signup + Coexistence
--
-- The effective connection remains one row per account in
-- whatsapp_config. A short-lived server-only table holds an exchanged
-- access token only when a WABA exposes multiple eligible phone numbers;
-- the browser receives an opaque session id and must explicitly select one.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS meta_business_id TEXT,
  ADD COLUMN IF NOT EXISTS is_on_biz_app BOOLEAN,
  ADD COLUMN IF NOT EXISTS platform_type TEXT,
  ADD COLUMN IF NOT EXISTS token_type TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS app_state_sync_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS app_state_sync_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_state_sync_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_state_sync_request_id TEXT,
  ADD COLUMN IF NOT EXISTS app_state_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS history_sync_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS history_sync_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_request_id TEXT,
  ADD COLUMN IF NOT EXISTS history_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disconnect_reason TEXT,
  ADD COLUMN IF NOT EXISTS disconnect_initiated_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_connection_mode_check'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_config
      ADD CONSTRAINT whatsapp_config_connection_mode_check
      CHECK (connection_mode IN ('manual', 'coexistence'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_subscription_status_check'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_config
      ADD CONSTRAINT whatsapp_config_subscription_status_check
      CHECK (subscription_status IN ('unknown', 'pending', 'subscribed', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_app_state_sync_status_check'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_config
      ADD CONSTRAINT whatsapp_config_app_state_sync_status_check
      CHECK (app_state_sync_status IN ('not_requested', 'requesting', 'requested', 'completed', 'failed', 'delivery_unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_history_sync_status_check'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_config
      ADD CONSTRAINT whatsapp_config_history_sync_status_check
      CHECK (history_sync_status IN ('not_requested', 'requesting', 'requested', 'completed', 'failed', 'delivery_unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_waba_id
  ON public.whatsapp_config (waba_id)
  WHERE waba_id IS NOT NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'cloud_api';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_source_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_source_check
      CHECK (source IN ('cloud_api', 'whatsapp_business_app', 'coexistence_history'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_source_created_at
  ON public.messages (source, created_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_embedded_signup_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  meta_business_id TEXT,
  token_type TEXT,
  token_expires_at TIMESTAMPTZ,
  candidates JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT whatsapp_embedded_signup_sessions_candidates_array
    CHECK (jsonb_typeof(candidates) = 'array'),
  CONSTRAINT whatsapp_embedded_signup_sessions_expiry_order
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_embedded_sessions_account_active
  ON public.whatsapp_embedded_signup_sessions (account_id, expires_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.whatsapp_embedded_signup_sessions ENABLE ROW LEVEL SECURITY;

-- The table is intentionally inaccessible through the Data API. All access
-- goes through authenticated server routes after an owner/admin role check.
REVOKE ALL ON TABLE public.whatsapp_embedded_signup_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_embedded_signup_sessions TO service_role;

COMMENT ON TABLE public.whatsapp_embedded_signup_sessions IS
  'Short-lived, server-only token escrow for ambiguous Embedded Signup phone selection.';
COMMENT ON COLUMN public.whatsapp_config.connection_mode IS
  'manual for legacy Cloud API setup; coexistence for Embedded Signup v4 business-app onboarding.';
COMMENT ON COLUMN public.messages.source IS
  'Origin used to suppress live-message side effects for coexistence echoes and imported history.';
