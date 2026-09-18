import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validNewPassword, PASSWORD_MINIMUM_MESSAGE } from '@/lib/auth/policy';
import { authRequestAllowed } from '@/lib/auth/request';

export async function POST(request: Request) {
  if (!authRequestAllowed(request)) {
    return NextResponse.json(
      { error: 'Solicitação não permitida.' },
      { status: 403 }
    );
  }
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['email', 'password', 'fullName', 'inviteToken'].includes(key)
    ) ||
    typeof body.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    typeof body.fullName !== 'string' ||
    !body.fullName.trim() ||
    body.fullName.trim().length > 120 ||
    (body.inviteToken !== undefined &&
      (typeof body.inviteToken !== 'string' ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(body.inviteToken)))
  ) {
    return NextResponse.json(
      { error: 'Dados de cadastro inválidos.' },
      { status: 400 }
    );
  }
  if (!validNewPassword(body.password)) {
    return NextResponse.json(
      { error: PASSWORD_MINIMUM_MESSAGE },
      { status: 400 }
    );
  }
  try {
    const supabase = await createClient();
    // Do not replace an already authenticated browser's identity via signup.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user)
      return NextResponse.json(
        { error: 'Saia da conta antes de criar outra.' },
        { status: 409 }
      );
    const origin = new URL(
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.url
    ).origin;
    const { data, error } = await supabase.auth.signUp({
      email: body.email.trim(),
      password: body.password,
      options: {
        data: { full_name: body.fullName.trim() },
        ...(body.inviteToken
          ? {
              emailRedirectTo: `${origin}/join/${encodeURIComponent(body.inviteToken)}`,
            }
          : {}),
      },
    });
    if (error || !data.user) {
      return NextResponse.json(
        {
          error:
            'Não foi possível criar a conta. Verifique os dados ou procure o administrador.',
        },
        { status: 400 }
      );
    }
    // The existing transactional Auth INSERT trigger is the only bootstrap.
    // Never return session tokens, or create a second account/profile here.
    return NextResponse.json({ hasSession: Boolean(data.session) });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível criar a conta. Tente novamente mais tarde.' },
      { status: 500 }
    );
  }
}
