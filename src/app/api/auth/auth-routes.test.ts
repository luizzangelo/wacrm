import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: mocks }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (
    _url: string,
    _key: string,
    options: {
      auth: {
        persistSession: boolean;
        autoRefreshToken: boolean;
        detectSessionInUrl: boolean;
      };
    }
  ) => {
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    return { auth: { signInWithPassword: mocks.signInWithPassword } };
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: vi.fn(),
}));
import { POST as signup } from './signup/route';
import { POST as password } from './password/route';
import { validNewPassword } from '@/lib/auth/policy';

function request(
  path: string,
  body: unknown,
  origin = 'https://crm.luizangelo.com.br'
) {
  return new Request(`https://crm.luizangelo.com.br/api/auth/${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const signupBody = {
  email: 'fixture@example.invalid',
  fullName: 'Fixture',
  password: '12345678',
};
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.luizangelo.com.br');
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.signUp.mockResolvedValue({
    data: { user: { id: 'A' }, session: { access_token: 'never-return-this' } },
    error: null,
  });
  mocks.signInWithPassword.mockResolvedValue({
    data: { user: { id: 'A' } },
    error: null,
  });
  mocks.updateUser.mockResolvedValue({
    data: { user: { id: 'A' } },
    error: null,
  });
});
describe('WACRM password policy and cookie-auth routes', () => {
  it('rejects 7, accepts 8, preserves whitespace and rejects nonstrings', () => {
    expect(validNewPassword('1234567')).toBe(false);
    expect(validNewPassword('12345678')).toBe(true);
    expect(validNewPassword(' 123456 ')).toBe(true);
    expect(validNewPassword(null)).toBe(false);
    expect(validNewPassword(12345678)).toBe(false);
  });
  it('enforces minimum in signup server before contacting Auth', async () => {
    expect(
      (await signup(request('signup', { ...signupBody, password: '1234567' })))
        .status
    ).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it('returns only session presence, never tokens, and invokes bootstrap only via signUp', async () => {
    const response = await signup(request('signup', signupBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasSession: true });
    expect(mocks.signUp).toHaveBeenCalledExactlyOnceWith({
      email: signupBody.email,
      password: signupBody.password,
      options: { data: { full_name: signupBody.fullName } },
    });
  });
  it('handles a successful signup without session honestly', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'A' }, session: null },
      error: null,
    });
    expect(await (await signup(request('signup', signupBody))).json()).toEqual({
      hasSession: false,
    });
  });
  it('preserves opaque invitation token destination without accepting tenant or role metadata', async () => {
    expect(
      (
        await signup(
          request('signup', { ...signupBody, inviteToken: 'opaque-token' })
        )
      ).status
    ).toBe(200);
    expect(mocks.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      'https://crm.luizangelo.com.br/join/opaque-token'
    );
    expect(
      (
        await signup(
          request('signup', {
            ...signupBody,
            account_id: 'B',
            account_role: 'owner',
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await signup(
          request('signup', {
            ...signupBody,
            inviteToken: 'https://evil.example',
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
  });
  it('does not replace an existing authenticated identity on signup', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'A' } } });
    expect((await signup(request('signup', signupBody))).status).toBe(409);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it.each([signup, password])(
    'rejects cross-origin or missing Origin',
    async (handler) => {
      expect(
        (await handler(request('signup', signupBody, 'https://evil.example')))
          .status
      ).toBe(403);
      const req = request('signup', signupBody);
      req.headers.delete('origin');
      expect((await handler(req)).status).toBe(403);
      expect(mocks.getUser).not.toHaveBeenCalled();
    }
  );
  it('validates 7 characters on password server, not merely the form', async () => {
    expect(
      (
        await password(
          request('password', {
            mode: 'change',
            currentPassword: 'old',
            password: '1234567',
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('uses getUser email, requires current password and ensures same user', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'A', email: 'real-auth@example.invalid' } },
      error: null,
    });
    expect(
      (
        await password(
          request('password', {
            mode: 'change',
            password: '12345678',
            currentPassword: 'old',
          })
        )
      ).status
    ).toBe(200);
    expect(mocks.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: 'real-auth@example.invalid',
      password: 'old',
    });
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: '12345678',
    });
  });
  it.each(['wrong-password', 'different-user'])(
    'never updates password after %s',
    async (cause) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: 'A', email: 'auth@example.invalid' } },
        error: null,
      });
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'B' } },
        error: cause === 'wrong-password' ? {} : null,
      });
      expect(
        (
          await password(
            request('password', {
              mode: 'change',
              password: '12345678',
              currentPassword: 'old',
            })
          )
        ).status
      ).toBe(401);
      expect(mocks.updateUser).not.toHaveBeenCalled();
    }
  );
  it('requires authenticated user and current password', async () => {
    expect(
      (
        await password(
          request('password', { mode: 'change', password: '12345678' })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await password(
          request('password', {
            mode: 'change',
            password: '12345678',
            currentPassword: 'old',
          })
        )
      ).status
    ).toBe(401);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('denies email recovery mode without SMTP even for a valid password', async () => {
    expect(
      (
        await password(
          request('password', { mode: 'recovery', password: '12345678' })
        )
      ).status
    ).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('does not leak raw Auth errors or secrets in responses', async () => {
    mocks.signUp.mockRejectedValue(
      new Error('private-token-password-service-role')
    );
    const response = await signup(request('signup', signupBody));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private-token');
  });
});
