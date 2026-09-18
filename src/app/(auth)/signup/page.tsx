'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MINIMUM_MESSAGE,
  validNewPassword,
} from '@/lib/auth/policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MessageSquare, CheckCircle, UsersRound } from 'lucide-react';

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // Keep the opaque invitation token for explicit acceptance after signup.
  // With an Auth session, Continue leads to /join, not a second bootstrap.
  const inviteToken = searchParams.get('invite');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    if (!validNewPassword(password)) {
      setError(PASSWORD_MINIMUM_MESSAGE);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          fullName,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Não foi possível criar a conta.');
        return;
      }
      setHasSession(result.hasSession === true);
      setSuccess(true);
    } catch {
      setError('Não foi possível criar a conta. Tente novamente mais tarde.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary h-6 w-6" />
            </div>
            <CardTitle className="text-foreground text-xl">
              {hasSession ? 'Conta criada' : 'Cadastro recebido'}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {hasSession
                ? inviteToken
                  ? 'Sua conta está pronta. Continue para aceitar o convite da equipe.'
                  : 'Sua conta está pronta. Continue para acessar o WACRM.'
                : 'Entre para continuar. Se não conseguir acessar, entre em contato com o administrador.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={
                hasSession
                  ? inviteToken
                    ? `/join/${encodeURIComponent(inviteToken)}`
                    : '/dashboard'
                  : inviteToken
                    ? `/login?invite=${encodeURIComponent(inviteToken)}`
                    : '/login'
              }
            >
              <Button
                variant="outline"
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
              >
                {hasSession ? 'Continuar' : 'Ir para entrar'}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            {inviteToken ? (
              <UsersRound className="text-primary h-6 w-6" />
            ) : (
              <MessageSquare className="text-primary h-6 w-6" />
            )}
          </div>
          <CardTitle className="text-foreground text-xl">
            {inviteToken ? 'Criar conta e participar' : 'Criar conta'}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? 'Crie sua conta e depois aceite o convite da equipe.'
              : 'Comece a usar o WACRM'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">
                Nome completo
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                maxLength={120}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Pelo menos 8 caracteres"
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="confirmPassword"
                className="text-muted-foreground"
              >
                Confirmar senha
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repita sua senha"
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            Já possui uma conta?{' '}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : '/login'
              }
              className="text-primary hover:text-primary/80"
            >
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
