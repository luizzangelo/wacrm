// Application policy only. Supabase's global minimum remains 6 until a
// separately authorized administrative change; direct Auth API calls can bypass
// the WACRM policy. Do not claim this is a project-wide password restriction.
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_MINIMUM_MESSAGE =
  'A senha deve ter pelo menos 8 caracteres.';
export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;
}

// Temporary product decision: no reliable external Auth email delivery yet.
// Re-enable only after SMTP/hook, templates and redirects are validated.
export const AUTH_EMAIL_SELF_SERVICE_ENABLED = false;
export const PASSWORD_SUPPORT_MESSAGE =
  'Entre em contato com o administrador para redefinir sua senha.';
export const EMAIL_SUPPORT_MESSAGE =
  'Para alterar seu e-mail, entre em contato com o administrador.';
