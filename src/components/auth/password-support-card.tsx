import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PASSWORD_SUPPORT_MESSAGE } from '@/lib/auth/policy';

export function PasswordSupportCard() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <KeyRound className="text-primary mb-2 h-6 w-6" />
          <CardTitle>Recuperar acesso</CardTitle>
          <CardDescription>{PASSWORD_SUPPORT_MESSAGE}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              Voltar para entrar
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
