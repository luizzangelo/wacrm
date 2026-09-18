// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/pt-BR.json';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  profileUpdate: vi.fn(),
  refreshProfile: vi.fn(),
  invite: '',
  user: {
    id: 'A',
    email: 'real-auth@example.invalid',
    created_at: '2026-01-01',
  },
  profile: {
    id: 'profile-A',
    user_id: 'A',
    full_name: 'Fixture',
    email: 'stale-copy@example.invalid',
    avatar_url: null,
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mocks.invite ? { invite: mocks.invite } : {}),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`
      .split('.')
      .reduce(
        (value: unknown, part) => (value as Record<string, unknown>)[part],
        messages
      ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: mocks.user,
    profile: mocks.profile,
    refreshProfile: mocks.refreshProfile,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
    },
    from: () => ({
      update: (body: unknown) => {
        mocks.profileUpdate(body);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));
import SignupPage from '@/app/(auth)/signup/page';
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page';
import ResetPasswordPage from '@/app/(auth)/reset-password/page';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
beforeEach(() => {
  mocks.invite = '';
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ hasSession: true }),
  });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fillSignup(password = '12345678') {
  const view = render(<SignupPage />);
  fireEvent.change(screen.getByLabelText('Nome completo'), {
    target: { value: 'Fixture' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'fixture@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Confirmar senha'), {
    target: { value: password },
  });
  fireEvent.submit(view.container.querySelector('form')!);
  return view;
}
describe('support-only Auth UI without SMTP', () => {
  it('autoconfirm signup does not claim confirmation mail and continues to dashboard', async () => {
    fillSignup();
    await screen.findByText('Conta criada');
    expect(
      screen.queryByText(/confirmação|confirmation|check your email|enviamos/i)
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Continuar' }).getAttribute('href')
    ).toBe('/dashboard');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves invitation after signup session, without accepting it automatically', async () => {
    mocks.invite = 'opaque_token';
    fillSignup();
    await screen.findByText('Conta criada');
    expect(
      screen.getByRole('link', { name: 'Continuar' }).getAttribute('href')
    ).toBe('/join/opaque_token');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).inviteToken).toBe(
      'opaque_token'
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not promise mail on unexpected no-session response', async () => {
    mocks.invite = 'opaque_token';
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ hasSession: false }),
    });
    fillSignup();
    await screen.findByText('Cadastro recebido');
    expect(
      screen.getByRole('link', { name: 'Ir para entrar' }).getAttribute('href')
    ).toBe('/login?invite=opaque_token');
    expect(screen.queryByText(/confirmation|confirmação|enviamos/i)).toBeNull();
  });
  it('rejects 7 characters before signup HTTP and uses minLength=8', async () => {
    fillSignup('1234567');
    expect(
      screen.getByText('A senha deve ter pelo menos 8 caracteres.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Senha').getAttribute('minlength')).toBe('8');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([ForgotPasswordPage, ResetPasswordPage])(
    'shows support without mounting an email/reset form or issuing HTTP',
    (Page) => {
      const view = render(<Page />);
      expect(
        screen.getByText(
          'Entre em contato com o administrador para redefinir sua senha.'
        )
      ).toBeTruthy();
      expect(view.container.querySelector('form')).toBeNull();
      expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );
  it('makes Auth email read-only, explains support and still saves only name/avatar', async () => {
    const view = render(<ProfileForm />);
    const input = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('real-auth@example.invalid');
    expect(
      screen.getByText(
        'Para alterar seu e-mail, entre em contato com o administrador.'
      )
    ).toBeTruthy();
    fireEvent.change(view.container.querySelector('#profile-full-name')!, {
      target: { value: 'New name' },
    });
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() =>
      expect(mocks.profileUpdate).toHaveBeenCalledExactlyOnceWith({
        full_name: 'New name',
        avatar_url: null,
      })
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('rejects 7-character new password, accepts 8 and submits to server without profile email', async () => {
    const view = render(<PasswordForm />);
    fireEvent.change(view.container.querySelector('#current-password')!, {
      target: { value: 'old' },
    });
    for (const id of ['new-password', 'confirm-password'])
      fireEvent.change(view.container.querySelector(`#${id}`)!, {
        target: { value: '1234567' },
      });
    fireEvent.submit(view.container.querySelector('form')!);
    expect(mocks.fetch).not.toHaveBeenCalled();
    for (const id of ['new-password', 'confirm-password'])
      fireEvent.change(view.container.querySelector(`#${id}`)!, {
        target: { value: '12345678' },
      });
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
        '/api/auth/password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'change',
            currentPassword: 'old',
            password: '12345678',
          }),
        }
      )
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
