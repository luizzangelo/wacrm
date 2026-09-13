import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

const RESET_PASSWORD_PATH = '/reset-password';
const INVALID_LINK_MESSAGE =
  'This password reset link is invalid or has expired. Request a new link.';

function redirectToResetPassword(error?: string) {
  const search = new URLSearchParams();

  if (error) search.set('error', error);

  const location = search.size
    ? `${RESET_PASSWORD_PATH}?${search.toString()}`
    : RESET_PASSWORD_PATH;

  // A relative Location preserves the public browser origin. This matters
  // behind Traefik, where request.url contains the internal 0.0.0.0:3000
  // origin, while also keeping the same route working on localhost.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const callbackError = request.nextUrl.searchParams.get('error');

  if (callbackError) {
    return redirectToResetPassword(INVALID_LINK_MESSAGE);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return redirectToResetPassword();
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      return redirectToResetPassword();
    }
  }

  return redirectToResetPassword(INVALID_LINK_MESSAGE);
}
