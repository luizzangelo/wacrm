'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, Unplug } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { initializeFacebookSdk } from '@/lib/whatsapp/embedded-signup-browser';

interface Status {
  connected: boolean;
  source: 'manual' | 'facebook_login' | null;
  adAccount: { id: string; name: string | null } | null;
  connectedAt: string | null;
  sdkConfig: { appId: string; configId: string; version: string } | null;
}

interface Choice {
  id: string;
  name: string;
}

export function MetaAdsConnection({
  canEdit,
  onChanged,
  refreshKey,
  children,
}: {
  canEdit: boolean;
  onChanged(): Promise<void> | void;
  refreshKey: number;
  children: React.ReactNode;
}) {
  const t = useTranslations('MetaAdsConnection');
  const format = useFormatter();
  const [status, setStatus] = useState<Status | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/meta-ads/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('status_failed');
    setStatus((await response.json()) as Status);
  }, []);

  useEffect(() => {
    void load().catch(() => toast.error(t('statusError')));
  }, [load, refreshKey, t]);

  useEffect(() => {
    if (!window.FB || !status?.sdkConfig) return;
    initializeFacebookSdk(
      window.FB,
      status.sdkConfig.appId,
      status.sdkConfig.version
    );
    setSdkReady(true);
  }, [status?.sdkConfig]);

  async function finish(body: Record<string, string>) {
    setBusy(true);
    try {
      const response = await fetch('/api/meta-ads/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Status & {
        error?: string;
        requiresSelection?: boolean;
        adAccounts?: Choice[];
      };
      if (!response.ok) throw new Error(payload.error ?? 'connection_failed');
      if (payload.requiresSelection) {
        setChoices(payload.adAccounts ?? []);
        return;
      }
      setChoices([]);
      await load();
      await onChanged();
      toast.success(t('connectedToast'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === 'ads_read_missing'
          ? t('permissionError')
          : t('connectionError')
      );
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    if (!window.FB || !sdkReady || !status?.sdkConfig) {
      toast.error(t('notConfigured'));
      return;
    }
    setBusy(true);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          toast.info(t('cancelled'));
          return;
        }
        void finish({ code });
      },
      {
        config_id: status.sdkConfig.configId,
        response_type: 'code',
        override_default_response_type: true,
      }
    );
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch('/api/meta-ads/disconnect', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('disconnect_failed');
      setChoices([]);
      await load();
      await onChanged();
      toast.success(t('disconnectedToast'));
    } catch {
      toast.error(t('disconnectError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Script
        id="facebook-jssdk"
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onReady={() => {
          if (!window.FB || !status?.sdkConfig) return;
          initializeFacebookSdk(
            window.FB,
            status.sdkConfig.appId,
            status.sdkConfig.version
          );
          setSdkReady(true);
        }}
        onError={() => setSdkReady(false)}
      />

      <div className="border-border bg-muted/20 space-y-3 rounded-lg border p-4">
        {status?.connected && status.adAccount ? (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {t('connected', {
                    name: status.adAccount.name ?? status.adAccount.id,
                    id: status.adAccount.id,
                  })}
                </p>
                {status.connectedAt ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('connectedAt', {
                      date: format.dateTime(new Date(status.connectedAt), {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="text-muted-foreground text-xs">{t('readOnly')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={disconnect}
              disabled={!canEdit || busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              {t('disconnect')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t('description')}</p>
            <Button
              type="button"
              onClick={connect}
              disabled={!canEdit || busy || !status?.sdkConfig}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('connect')}
            </Button>
          </>
        )}

        {choices.length > 1 ? (
          <div className="space-y-2">
            <label
              htmlFor="meta-ad-account-choice"
              className="text-sm font-medium"
            >
              {t('choose')}
            </label>
            <select
              id="meta-ad-account-choice"
              defaultValue=""
              disabled={busy}
              onChange={(event) =>
                event.target.value &&
                void finish({ adAccountId: event.target.value })
              }
              className="border-border bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="">{t('choosePlaceholder')}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name} ({choice.id})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <details className="border-border rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between p-3 text-sm font-medium">
          {t('advanced')} <ChevronDown className="size-4" />
        </summary>
        <div className="border-border border-t p-3">{children}</div>
      </details>
    </div>
  );
}
