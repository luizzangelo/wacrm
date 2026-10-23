BEGIN;

ALTER TABLE public.meta_conversion_config
  ADD COLUMN IF NOT EXISTS marketing_token_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS marketing_ad_account_name TEXT,
  ADD COLUMN IF NOT EXISTS marketing_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_ad_accounts JSONB;

UPDATE public.meta_conversion_config
SET marketing_token_source = 'manual'
WHERE marketing_access_token IS NOT NULL
  AND marketing_token_source IS NULL;

ALTER TABLE public.meta_conversion_config
  DROP CONSTRAINT IF EXISTS meta_conversion_config_marketing_token_source_check,
  ADD CONSTRAINT meta_conversion_config_marketing_token_source_check
    CHECK (marketing_token_source IS NULL OR marketing_token_source IN ('manual', 'facebook_login')),
  DROP CONSTRAINT IF EXISTS meta_conversion_config_marketing_ad_accounts_check,
  ADD CONSTRAINT meta_conversion_config_marketing_ad_accounts_check
    CHECK (marketing_ad_accounts IS NULL OR jsonb_typeof(marketing_ad_accounts) = 'array');

COMMENT ON COLUMN public.meta_conversion_config.marketing_token_source IS
  'Origin of the encrypted Marketing API credential: manual or facebook_login.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_ad_account_id IS
  'Selected non-secret Meta ad account id, stored without the act_ prefix.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_ad_account_name IS
  'Display name of the selected Meta ad account.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_connected_at IS
  'Timestamp of the latest successful Facebook Login connection.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_ad_accounts IS
  'Non-secret authorized ad-account choices discovered during Facebook Login.';

COMMIT;
