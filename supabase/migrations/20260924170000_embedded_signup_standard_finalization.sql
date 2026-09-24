-- Preserve the Embedded Signup flow type through server-only selection/PIN
-- sessions and represent standard Cloud API onboarding explicitly.

ALTER TABLE public.whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_connection_mode_check;

ALTER TABLE public.whatsapp_config
  ADD CONSTRAINT whatsapp_config_connection_mode_check
  CHECK (connection_mode IN ('manual', 'standard', 'coexistence'));

ALTER TABLE public.whatsapp_embedded_signup_sessions
  ADD COLUMN IF NOT EXISTS flow_mode TEXT NOT NULL DEFAULT 'coexistence';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_embedded_signup_sessions_flow_mode_check'
      AND conrelid = 'public.whatsapp_embedded_signup_sessions'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_embedded_signup_sessions
      ADD CONSTRAINT whatsapp_embedded_signup_sessions_flow_mode_check
      CHECK (flow_mode IN ('standard', 'coexistence'));
  END IF;
END $$;

COMMENT ON COLUMN public.whatsapp_embedded_signup_sessions.flow_mode IS
  'Server-side flow discriminator retained across phone selection and standard registration.';
