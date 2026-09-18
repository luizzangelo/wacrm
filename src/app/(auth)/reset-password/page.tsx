'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import {
  AUTH_EMAIL_SELF_SERVICE_ENABLED,
  MIN_PASSWORD_LENGTH,
  PASSWORD_MINIMUM_MESSAGE,
  validNewPassword,
} from '@/lib/auth/policy';
import { PasswordSupportCard } from '@/components/auth/password-support-card';

type RecoveryState = 'checking' | 'ready' | 'success' | 'error';

export default function ResetPasswordPage() {
  return AUTH_EMAIL_SELF_SERVICE_ENABLED ? (
    <ResetPasswordForm />
  ) : (
    <PasswordSupportCard />
  );
}

function ResetPasswordForm() {
  const supabase = createClient();
  const [state, setState] = useState<RecoveryState>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const checkRecoverySession = async () => {
      const callbackError = new URLSearchParams(window.location.search).get(
        'error'
      );

      if (callbackError) {
        setError(callbackError);
        setState('error');
        return;
      }

      const { data, error: userError } = await supabase.auth.getUser();

      if (!active) return;

      if (userError || !data.user) {
        setError(
          'This password reset link is invalid or has expired. Request a new link.'
        );
        setState('error');
        return;
      }

      setState('ready');
    };

    void checkRecoverySession();

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!validNewPassword(password)) {
      setError(PASSWORD_MINIMUM_MESSAGE);
      return;
    }

    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);

    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'recovery', password }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    if (!response?.ok) {
      setError(
        result?.error ||
          'Não foi possível alterar a senha. Tente novamente mais tarde.'
      );
      setSaving(false);
      return;
    }

    setPassword('');
    setConfirmation('');
    setSaving(false);
    setState('success');
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            {state === 'success' ? (
              <CheckCircle className="text-primary h-6 w-6" />
            ) : (
              <KeyRound className="text-primary h-6 w-6" />
            )}
          </div>
          <CardTitle className="text-foreground text-xl">
            {state === 'success' ? 'Password updated' : 'Choose a new password'}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {state === 'success'
              ? 'Your new password is ready to use.'
              : 'Enter and confirm the new password for your account.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {state === 'checking' && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking reset link...
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
              <Link href="/forgot-password">
                <Button className="w-full">Request a new reset link</Button>
              </Link>
            </div>
          )}

          {state === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={saving}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={saving}
                  required
                />
              </div>

              <Button type="submit" disabled={saving} className="w-full">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update password'
                )}
              </Button>
            </form>
          )}

          {state === 'success' && (
            <Link href="/dashboard">
              <Button className="w-full">Continue to WACRM</Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
