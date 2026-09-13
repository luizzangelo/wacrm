import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}));

import { GET } from './route';

describe('password recovery callback', () => {
  beforeEach(() => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it('exchanges a PKCE code and redirects to the reset form', async () => {
    const response = await GET(
      new NextRequest(
        'https://crm.luizangelo.com.br/auth/callback?code=recovery-code&next=/reset-password'
      )
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/reset-password');
  });

  it('also accepts token-hash recovery links', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=recovery-hash&type=recovery'
      )
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'recovery-hash',
      type: 'recovery',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/reset-password');
  });

  it('turns expired links into a useful reset-page error', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired'
      )
    );

    const location = new URL(
      response.headers.get('location')!,
      'http://localhost:3000'
    );
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('error')).toContain(
      'invalid or has expired'
    );
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('does not follow an untrusted next URL', async () => {
    const response = await GET(
      new NextRequest(
        'https://crm.luizangelo.com.br/auth/callback?code=recovery-code&next=https://evil.example'
      )
    );

    expect(response.headers.get('location')).toBe('/reset-password');
  });
});
