'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Unplug,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  initializeFacebookSdk,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupSessionEvent,
} from '@/lib/whatsapp/embedded-signup-browser';

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? '';
const CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ?? '';
const FLOW_TIMEOUT_MS = 2 * 60_000;

type Phase =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'validating'
  | 'selecting'
  | 'connected'
  | 'error';

interface PhoneChoice {
  id: string;
  display_number: string;
  verified_name: string | null;
}

interface Props {
  canEdit: boolean;
  connected: boolean;
  connectionMode?: string | null;
  displayNumber?: string | null;
  verifiedName?: string | null;
  subscriptionStatus?: string | null;
  appStateSyncStatus?: string | null;
  historySyncStatus?: string | null;
  onChanged(): Promise<void> | void;
}

export function WhatsAppEmbeddedSignup({
  canEdit,
  connected,
  connectionMode,
  displayNumber,
  verifiedName,
  subscriptionStatus,
  appStateSyncStatus,
  historySyncStatus,
  onChanged,
}: Props) {
  const [sdkReady, setSdkReady] = useState(false);
  const [phase, setPhase] = useState<Phase>(connected ? 'connected' : 'idle');
  const [code, setCode] = useState<string | null>(null);
  const [session, setSession] = useState<Extract<
    EmbeddedSignupSessionEvent,
    { kind: 'finish' }
  > | null>(null);
  const [selectionSessionId, setSelectionSessionId] = useState<string | null>(
    null
  );
  const [choices, setChoices] = useState<PhoneChoice[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completingRef = useRef(false);

  useEffect(() => {
    setPhase(connected ? 'connected' : 'idle');
  }, [connected]);

  const clearFlowTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupMessage(event.origin, event.data);
      if (!parsed) return;
      if (parsed.kind === 'finish') {
        setSession(parsed);
        setPhase('validating');
      } else if (parsed.kind === 'cancel') {
        clearFlowTimeout();
        setPhase('idle');
        toast.info('A conexão com a Meta foi cancelada.');
      } else {
        clearFlowTimeout();
        setPhase('error');
        toast.error('A Meta informou um erro durante a autorização.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearFlowTimeout();
    };
  }, [clearFlowTimeout]);

  const finishRequest = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(String(result.error ?? 'connection_failed'));
      if (result.requires_phone_selection === true) {
        const phoneNumbers = Array.isArray(result.phone_numbers)
          ? (result.phone_numbers as PhoneChoice[])
          : [];
        setSelectionSessionId(String(result.selection_session_id ?? ''));
        setChoices(phoneNumbers);
        setPhase('selecting');
        return;
      }
      clearFlowTimeout();
      setPhase('connected');
      setCode(null);
      setSession(null);
      setChoices([]);
      setSelectionSessionId(null);
      toast.success('WhatsApp Business conectado ao WACRM.');
      await onChanged();
    },
    [clearFlowTimeout, onChanged]
  );

  useEffect(() => {
    if (!code || !session || completingRef.current) return;
    completingRef.current = true;
    setPhase('validating');
    void finishRequest({
      kind: 'complete',
      code,
      waba_id: session.wabaId,
      phone_number_id: session.phoneNumberId,
      business_id: session.businessId,
    })
      .catch((error) => {
        setPhase('error');
        toast.error(
          error instanceof Error && error.message === 'exchange_outcome_unknown'
            ? 'A troca do código ficou indeterminada. Inicie a conexão novamente; o mesmo código não será reutilizado.'
            : 'Não foi possível concluir a conexão com a Meta.'
        );
      })
      .finally(() => {
        completingRef.current = false;
      });
  }, [code, session, finishRequest]);

  function connect() {
    if (!window.FB || !sdkReady || !APP_ID || !CONFIG_ID) {
      toast.error('Embedded Signup não está configurado neste ambiente.');
      return;
    }
    clearFlowTimeout();
    setCode(null);
    setSession(null);
    setChoices([]);
    setSelectionSessionId(null);
    setPhase('opening');
    timeoutRef.current = setTimeout(() => {
      setPhase('error');
      toast.error('A autorização da Meta expirou. Tente novamente.');
    }, FLOW_TIMEOUT_MS);
    window.FB.login(
      (response) => {
        const authorizationCode = response.authResponse?.code;
        if (!authorizationCode) {
          clearFlowTimeout();
          setPhase('idle');
          toast.info(
            'A janela da Meta foi fechada ou a autorização foi cancelada.'
          );
          return;
        }
        setCode(authorizationCode);
        setPhase('waiting');
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      }
    );
  }

  async function selectPhone(phoneNumberId: string) {
    if (!selectionSessionId) return;
    setPhase('validating');
    try {
      await finishRequest({
        kind: 'select',
        session_id: selectionSessionId,
        phone_number_id: phoneNumberId,
      });
    } catch {
      setPhase('error');
      toast.error('Não foi possível validar o número selecionado.');
    }
  }

  async function disconnect() {
    if (
      !confirm(
        'O WACRM deixará de usar esta conexão, mas conversas e histórico serão preservados. Depois, remova o parceiro pelo WhatsApp Business no celular. Continuar?'
      )
    ) {
      return;
    }
    setPhase('validating');
    try {
      const response = await fetch('/api/whatsapp/embedded-signup/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw new Error('disconnect_failed');
      setPhase('idle');
      toast.success(
        'Conexão desativada no WACRM. Conclua a remoção do parceiro no WhatsApp Business.'
      );
      await onChanged();
    } catch {
      setPhase('error');
      toast.error('Não foi possível desconectar o WhatsApp.');
    }
  }

  const busy = ['opening', 'waiting', 'validating'].includes(phase);
  const phaseText =
    phase === 'opening'
      ? 'Abrindo Meta...'
      : phase === 'waiting'
        ? 'Aguardando autorização...'
        : phase === 'validating'
          ? 'Validando conta, conectando número e sincronizando...'
          : null;

  return (
    <>
      <Script
        id="facebook-jssdk"
        src="https://connect.facebook.net/pt_BR/sdk.js"
        strategy="afterInteractive"
        onReady={() => {
          if (!window.FB || !APP_ID) return;
          initializeFacebookSdk(window.FB, APP_ID);
          setSdkReady(true);
        }}
        onError={() => {
          setSdkReady(false);
          setPhase('error');
        }}
      />
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="text-primary size-5" />
                {connected ? 'WhatsApp conectado' : 'Nenhum número conectado'}
              </CardTitle>
              <CardDescription className="mt-2">
                Conecte seu WhatsApp Business ao WACRM e continue usando o
                aplicativo no celular.
              </CardDescription>
            </div>
            {connected ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
            ) : phase === 'error' ? (
              <XCircle className="size-5 shrink-0 text-red-500" />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected && (
            <div className="border-border bg-background/60 grid gap-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Número:</span>{' '}
                {displayNumber || 'Validado pela Meta'}
              </div>
              <div>
                <span className="text-muted-foreground">Nome verificado:</span>{' '}
                {verifiedName || 'Não informado'}
              </div>
              <div>
                <span className="text-muted-foreground">Modo:</span>{' '}
                {connectionMode === 'coexistence'
                  ? 'WhatsApp Business + WACRM'
                  : 'Cloud API manual'}
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{' '}
                {subscriptionStatus || 'connected'}
              </div>
              {connectionMode === 'coexistence' && (
                <div className="text-muted-foreground text-xs sm:col-span-2">
                  Sincronização: contatos{' '}
                  {appStateSyncStatus || 'não solicitada'} · histórico{' '}
                  {historySyncStatus || 'não solicitado'}
                </div>
              )}
            </div>
          )}

          {phase === 'selecting' && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-medium">
                Escolha o número autorizado nesta WABA
              </p>
              {choices.map((phone) => (
                <Button
                  key={phone.id}
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start py-3 text-left"
                  onClick={() => void selectPhone(phone.id)}
                >
                  <span>
                    <span className="block">{phone.display_number}</span>
                    {phone.verified_name && (
                      <span className="text-muted-foreground block text-xs">
                        {phone.verified_name}
                      </span>
                    )}
                  </span>
                </Button>
              ))}
            </div>
          )}

          {phaseText && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> {phaseText}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {(!connected || connectionMode !== 'coexistence') && (
              <Button
                type="button"
                onClick={connect}
                disabled={
                  !canEdit || busy || !sdkReady || !APP_ID || !CONFIG_ID
                }
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Conectar WhatsApp
              </Button>
            )}
            {connected && connectionMode === 'coexistence' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void disconnect()}
                disabled={!canEdit || busy}
                className="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
              >
                <Unplug className="size-4" /> Desconectar WhatsApp
              </Button>
            )}
          </div>
          {(!APP_ID || !CONFIG_ID) && (
            <p className="text-xs text-amber-600">
              Embedded Signup indisponível: configuração pública ausente neste
              build.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
