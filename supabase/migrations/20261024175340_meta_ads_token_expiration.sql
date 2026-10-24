-- Persist Facebook Login token expiry metadata per WACRM workspace.
ALTER TABLE public.meta_conversion_config
  ADD COLUMN IF NOT EXISTS marketing_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_data_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_token_expired_at timestamptz;

COMMENT ON COLUMN public.meta_conversion_config.marketing_token_expires_at IS
  'Token expiration reported by Meta debug_token for a Facebook Login connection.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_data_access_expires_at IS
  'Data-access expiration reported by Meta debug_token for a Facebook Login connection.';
COMMENT ON COLUMN public.meta_conversion_config.marketing_token_expired_at IS
  'Set when Meta rejects the Facebook Login token as expired (error code 190).';
