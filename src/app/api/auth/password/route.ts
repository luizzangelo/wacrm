import { NextResponse } from 'next/server';
import { createClient as createVerificationClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authRequestAllowed } from '@/lib/auth/request';
import {
  AUTH_EMAIL_SELF_SERVICE_ENABLED,
  PASSWORD_SUPPORT_MESSAGE,
  validNewPassword,
  PASSWORD_MINIMUM_MESSAGE,
} from '@/lib/auth/policy';

export async function POST(request: Request) {
  if (!authRequestAllowed(request))
    return NextResponse.json(
      { error: 'Solicitação não permitida.' },
      { status: 403 }
    );
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['password', 'currentPassword', 'mode'].includes(key)
    ) ||
    !['change', 'recovery'].includes(body.mode)
  ) {
    return NextResponse.json(
      { error: 'Solicitação inválida.' },
      { status: 400 }
    );
  }
  if (body.mode === 'recovery' && !AUTH_EMAIL_SELF_SERVICE_ENABLED) {
    return NextResponse.json(
      { error: PASSWORD_SUPPORT_MESSAGE },
      { status: 403 }
    );
  }
  if (!validNewPassword(body.password))
    return NextResponse.json(
      { error: PASSWORD_MINIMUM_MESSAGE },
      { status: 400 }
    );
  if (
    body.mode === 'change' &&
    (typeof body.currentPassword !== 'string' || !body.currentPassword)
  ) {
    return NextResponse.json(
      { error: 'Informe sua senha atual.' },
      { status: 400 }
    );
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user?.email)
      return NextResponse.json(
        { error: 'Sessão inválida. Entre novamente.' },
        { status: 401 }
      );
    const limit = checkRateLimit(
      `auth:password:${user.id}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    if (body.mode === 'change') {
      // Auth is the source of truth; never authenticate with profiles.email.
      // Isolate verification from the cookie-backed client: a concurrent email
      // reassignment must never switch the browser to another user's session.
      // Uses only the public project key, not an administrative client.
      const verifier = createVerificationClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );
      const verified = await verifier.auth.signInWithPassword({
        email: user.email,
        password: body.currentPassword,
      });
      if (verified.error || verified.data.user?.id !== user.id) {
        return NextResponse.json(
          {
            error:
              'A senha atual está incorreta ou a sessão mudou. Entre novamente.',
          },
          { status: 401 }
        );
      }
    }
    const updated = await supabase.auth.updateUser({ password: body.password });
    if (updated.error || updated.data.user?.id !== user.id)
      return NextResponse.json(
        { error: 'Não foi possível alterar a senha.' },
        { status: 400 }
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível alterar a senha.' },
      { status: 500 }
    );
  }
}
