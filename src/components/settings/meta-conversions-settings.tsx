'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';

import { SettingsPanelHead } from './settings-panel-head';
import { MetaConversionEvents } from './meta-conversion-events';

interface SafeConfig {
  configured: boolean;
  enabled: boolean;
  dataset_id: string | null;
  has_access_token: boolean;
  has_marketing_access_token: boolean;
  whatsapp: {
    configured: boolean;
    waba_id: string | null;
    phone_number_id: string | null;
  };
}

interface ValidationCheck {
  status:
    | 'valid'
    | 'invalid_token'
    | 'not_found'
    | 'forbidden'
    | 'api_error'
    | 'network_error'
    | 'not_checked';
}

interface ValidationResult {
  valid: boolean;
  read_only: true;
  token: ValidationCheck;
  dataset: ValidationCheck;
  whatsapp: { status: 'valid'; waba_id: string; source: 'local' };
  marketing_token: ValidationCheck & { configured: boolean };
}

const EMPTY_CONFIG: SafeConfig = {
  configured: false,
  enabled: false,
  dataset_id: null,
  has_access_token: false,
  has_marketing_access_token: false,
  whatsapp: {
    configured: false,
    waba_id: null,
    phone_number_id: null,
  },
};

export function MetaConversionsSettings() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations('Settings.metaConversions');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [config, setConfig] = useState<SafeConfig>(EMPTY_CONFIG);
  const [datasetId, setDatasetId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [marketingToken, setMarketingToken] = useState('');
  const [clearMarketingToken, setClearMarketingToken] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/meta-conversions/config', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as SafeConfig & {
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? t('loadFailed'));
        return;
      }

      setConfig(payload);
      setDatasetId(payload.dataset_id ?? '');
      setEnabled(payload.enabled);
      // Stored secrets are represented only by has_* booleans. Inputs always
      // remain empty and are never hydrated with plaintext or ciphertext.
      setAccessToken('');
      setMarketingToken('');
      setClearMarketingToken(false);
      setDirty(false);
      setValidation(null);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void loadConfig();
  }, [accountId, loadConfig]);

  const hasAccessToken = Boolean(accessToken.trim() || config.has_access_token);
  const hasMarketingToken = Boolean(
    marketingToken.trim() ||
    (config.has_marketing_access_token && !clearMarketingToken)
  );
  const canEnable = Boolean(
    datasetId.trim() && hasAccessToken && config.whatsapp.waba_id
  );

  function changeEnabled(next: boolean) {
    if (next && !canEnable) {
      toast.error(t('incompleteEnable'));
      return;
    }
    setEnabled(next);
    setDirty(true);
    setValidation(null);
  }

  async function handleSave() {
    if (enabled && !canEnable) {
      toast.error(t('incompleteEnable'));
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string | boolean | null> = {
        dataset_id: datasetId.trim() || null,
        enabled,
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      if (marketingToken.trim()) {
        body.marketing_access_token = marketingToken.trim();
      } else if (clearMarketingToken) {
        body.clear_marketing_access_token = true;
      }

      const response = await fetch('/api/meta-conversions/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SafeConfig & {
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? t('saveFailed'));
        return;
      }

      setConfig(payload);
      setAccessToken('');
      setMarketingToken('');
      setClearMarketingToken(false);
      setDirty(false);
      setValidation(null);
      toast.success(t('saveSuccess'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    if (dirty) {
      toast.error(t('saveBeforeValidate'));
      return;
    }

    setValidating(true);
    setValidation(null);
    try {
      const response = await fetch('/api/meta-conversions/config/validate', {
        method: 'POST',
      });
      const payload = (await response.json()) as ValidationResult & {
        error?: string;
      };
      if (!response.ok) {
        toast.error(payload.error ?? t('validationFailed'));
        return;
      }

      setValidation(payload);
      if (payload.valid) toast.success(t('validationSuccess'));
      else toast.error(t('validationRejected'));
    } catch {
      toast.error(t('validationFailed'));
    } finally {
      setValidating(false);
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="mr-2 size-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const disabled = !canEditSettings || saving || validating;

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {canEditSettings && accountId ? (
        <MetaConversionEvents key={accountId} accountId={accountId} />
      ) : null}

      {!canEditSettings ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>{t('readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('readOnlyDescription')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('statusTitle')}</CardTitle>
          <CardDescription>{t('statusDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="meta-conversions-enabled" className="text-sm">
                {t('enableLabel')}
              </Label>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('enableHelper')}
              </p>
            </div>
            <Switch
              id="meta-conversions-enabled"
              checked={enabled}
              onCheckedChange={changeEnabled}
              disabled={disabled}
              aria-label={t('enableLabel')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('credentialsTitle')}</CardTitle>
          <CardDescription>{t('credentialsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="meta-dataset-id">{t('datasetLabel')}</Label>
            <Input
              id="meta-dataset-id"
              type="text"
              inputMode="numeric"
              value={datasetId}
              onChange={(event) => {
                setDatasetId(event.target.value);
                setDirty(true);
                setValidation(null);
              }}
              placeholder={t('datasetPlaceholder')}
              disabled={disabled}
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              {t('datasetHelper')}
            </p>
          </div>

          <SecretField
            id="meta-capi-access-token"
            label={t('accessTokenLabel')}
            helper={t('accessTokenHelper')}
            configured={hasAccessToken}
            value={accessToken}
            onChange={(value) => {
              setAccessToken(value);
              setDirty(true);
              setValidation(null);
            }}
            configuredLabel={t('configured')}
            notConfiguredLabel={t('notConfigured')}
            placeholder={t('tokenPlaceholder')}
            disabled={disabled}
          />

          <div className="space-y-2">
            <SecretField
              id="meta-marketing-access-token"
              label={t('marketingTokenLabel')}
              helper={t('marketingTokenHelper')}
              configured={hasMarketingToken}
              value={marketingToken}
              onChange={(value) => {
                setMarketingToken(value);
                setClearMarketingToken(false);
                setDirty(true);
                setValidation(null);
              }}
              configuredLabel={t('configured')}
              notConfiguredLabel={t('notConfigured')}
              placeholder={t('tokenPlaceholder')}
              disabled={disabled}
            />
            {config.has_marketing_access_token && !clearMarketingToken ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMarketingToken('');
                  setClearMarketingToken(true);
                  setDirty(true);
                  setValidation(null);
                }}
                disabled={disabled}
              >
                <Trash2 className="size-4" />
                {t('removeMarketingToken')}
              </Button>
            ) : clearMarketingToken ? (
              <p className="text-muted-foreground text-xs">
                {t('marketingRemovalPending')}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('whatsappTitle')}</CardTitle>
          <CardDescription>{t('whatsappDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {config.whatsapp.configured ? (
            <dl className="border-border grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t('wabaId')}
                </dt>
                <dd className="text-foreground mt-1 font-mono text-sm break-all">
                  {config.whatsapp.waba_id}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t('phoneNumber')}
                </dt>
                <dd className="text-foreground mt-1 font-mono text-sm break-all">
                  {config.whatsapp.phone_number_id}
                </dd>
              </div>
            </dl>
          ) : (
            <Alert>
              <CircleAlert />
              <AlertTitle>{t('whatsappNotConfigured')}</AlertTitle>
              <AlertDescription>
                {t('whatsappNotConfiguredDescription')}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {validation ? (
        <Alert variant={validation.valid ? 'default' : 'destructive'}>
          {validation.valid ? <ShieldCheck /> : <CircleAlert />}
          <AlertTitle>
            {validation.valid
              ? t('validationSuccess')
              : t('validationRejected')}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              <li>
                {t('tokenResult', {
                  status: t(`status.${validation.token.status}`),
                })}
              </li>
              <li>
                {t('datasetResult', {
                  status: t(`status.${validation.dataset.status}`),
                })}
              </li>
              <li>{t('wabaResult', { status: t('status.valid') })}</li>
              {validation.marketing_token.configured ? (
                <li>
                  {t('marketingResult', {
                    status: t(`status.${validation.marketing_token.status}`),
                  })}
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={handleValidate}
          disabled={disabled || !config.configured}
        >
          {validating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {t('validateButton')}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={disabled || !dirty}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('saveButton')}
        </Button>
      </div>
    </section>
  );
}

function SecretField({
  id,
  label,
  helper,
  configured,
  value,
  onChange,
  configuredLabel,
  notConfiguredLabel,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  helper: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  configuredLabel: string;
  notConfiguredLabel: string;
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Badge variant={configured ? 'secondary' : 'outline'}>
          {configured ? configuredLabel : notConfiguredLabel}
        </Badge>
      </div>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="new-password"
        spellCheck={false}
      />
      <p className="text-muted-foreground text-xs">{helper}</p>
    </div>
  );
}
