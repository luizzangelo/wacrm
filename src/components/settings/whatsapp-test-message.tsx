'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';

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

interface WhatsAppTestMessageProps {
  connected: boolean;
  canSend: boolean;
}

export function WhatsAppTestMessage({
  connected,
  canSend,
}: WhatsAppTestMessageProps) {
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSend() {
    const destination = phone.trim();
    if (!destination || sending) return;

    setSending(true);
    setSuccess(false);
    setError('');

    try {
      const response = await fetch('/api/whatsapp/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: destination }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;

      if (!response.ok) {
        setError(
          typeof body?.error === 'string'
            ? body.error
            : 'Não foi possível enviar a mensagem de teste.'
        );
        return;
      }

      setSuccess(true);
    } catch {
      setError('Não foi possível enviar a mensagem de teste. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">
          Mensagem de teste da Meta
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Envie o template oficial Hello World para validar a integração no App
          Review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="meta-test-phone" className="text-muted-foreground">
            Número do destinatário
          </Label>
          <Input
            id="meta-test-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Ex.: +55 85 99999-0000"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setSuccess(false);
              setError('');
            }}
            disabled={sending || !canSend}
            className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
          />
          <p className="text-muted-foreground text-xs">
            Inclua o código do país e o DDD.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleSend}
          disabled={sending || !canSend || !connected || !phone.trim()}
        >
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Send className="size-4" />
              Enviar Hello World
            </>
          )}
        </Button>

        {!connected && (
          <p className="text-muted-foreground text-sm">
            Conecte o WhatsApp para habilitar o envio.
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-emerald-600">
            Mensagem enviada.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
