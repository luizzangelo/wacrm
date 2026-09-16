'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import {
  DIAGNOSTIC_EVENTS,
  DIAGNOSTIC_STATUSES,
  type EventDiagnostic,
  type EventDiagnosticsPage,
} from '@/lib/meta-conversions/event-diagnostics-types';

export function MetaConversionEventDiagnostic({
  event,
  datasetId,
}: {
  event: EventDiagnostic;
  datasetId: string | null;
}) {
  const t = useTranslations('MetaConversionEvents');
  const time = (value: string | null) =>
    value ? value.replace('T', ' ').replace('.000Z', ' UTC') : '—';
  return (
    <details className="border-border rounded-lg border p-4">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className="font-medium">{event.event_name}</span>
        <Badge
          variant={
            event.status === 'failed'
              ? 'destructive'
              : event.status === 'delivery_unknown'
                ? 'outline'
                : 'secondary'
          }
          className={
            event.status === 'delivery_unknown'
              ? 'border-amber-500 text-amber-700 dark:text-amber-400'
              : undefined
          }
        >
          {event.status}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {time(event.created_at)}
        </span>
        <span className="text-muted-foreground text-xs">
          {t('attempts')}: {event.attempts}
        </span>
        <span className="text-muted-foreground text-xs">
          {event.contact_id
            ? `${t('contact')} · ${event.contact_id.slice(0, 8)}`
            : t('contactUnavailable')}
        </span>
      </summary>
      <div className="mt-4 space-y-3 text-sm">
        {event.status === 'failed' ? (
          <p className="text-destructive">{t('failedExplanation')}</p>
        ) : null}
        {event.status === 'delivery_unknown' ? (
          <div className="rounded-md bg-amber-500/10 p-3" role="note">
            <p>{t('unknownExplanation')}</p>
            <p className="mt-1 text-xs">{t('unknownHelp')}</p>
          </div>
        ) : null}
        {event.status === 'sending' ? (
          <p>
            {t('sendingAge', { seconds: event.sending_age_seconds ?? 0 })}
            {event.sending_stale ? ` — ${t('stale')}` : ''}
          </p>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            [t('eventId'), event.event_id_masked],
            [t('deal'), event.deal_id ?? t('dealRemoved')],
            [
              t('contact'),
              event.contact_id
                ? `${t('contact')} · ${event.contact_id.slice(0, 8)}`
                : t('contactUnavailable'),
            ],
            [t('pipeline'), event.pipeline ?? '—'],
            [t('stage'), event.stage ?? '—'],
            [t('attribution'), event.attribution_present ? t('yes') : t('no')],
            [t('eventTime'), time(event.event_time)],
            [t('created'), time(event.created_at)],
            [t('updated'), time(event.updated_at)],
            [t('sentAt'), time(event.sent_at)],
            ['HTTP', event.http_status ?? '—'],
            ['Meta code', event.meta_error_code ?? '—'],
            ['Meta subcode', event.meta_error_subcode ?? '—'],
            [t('dataset'), datasetId ?? '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 break-all">{value}</dd>
            </div>
          ))}
          {event.purchase ? (
            <>
              <div>
                <dt className="text-muted-foreground text-xs">
                  {t('purchaseValue')}
                </dt>
                <dd>{event.purchase.value ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Currency</dt>
                <dd>{event.purchase.currency ?? '—'}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {event.diagnostic_message ? <p>{event.diagnostic_message}</p> : null}
        <p className="text-muted-foreground text-xs">{t('timestampHelp')}</p>
      </div>
    </details>
  );
}

export function MetaConversionEvents({ accountId }: { accountId: string }) {
  const t = useTranslations('MetaConversionEvents');
  const [status, setStatus] = useState('');
  const [eventName, setEventName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<EventDiagnosticsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
      status,
      event_name: eventName,
      from,
      to,
    });
    async function load() {
      setLoading(true);
      setError(false);
      setResult(null);
      try {
        const response = await fetch(`/api/meta-conversions/events?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as EventDiagnosticsPage;
        if (active) setResult(data);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, status, eventName, from, to, page, refresh]);
  const skipped = result
    ? result.counts.skipped_disabled +
      result.counts.skipped_no_attribution +
      result.counts.skipped_missing_config
    : 0;
  const pages = result
    ? Math.max(1, Math.ceil(result.total / result.page_size))
    : 1;
  const selectClass =
    'border-input bg-background h-9 rounded-md border px-3 text-sm';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            ...DIAGNOSTIC_STATUSES.slice(0, 5).map(
              (s) => [s, result?.counts[s] ?? '—'] as const
            ),
            ['Skipped', result ? skipped : '—'] as const,
          ].map(([label, count]) => (
            <div key={label} className="border-border rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="mt-1 text-xl font-semibold">{count}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="capi-status">Status</Label>
            <select
              id="capi-status"
              className={selectClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('all')}</option>
              {DIAGNOSTIC_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="capi-event">{t('event')}</Label>
            <select
              id="capi-event"
              className={selectClass}
              value={eventName}
              onChange={(e) => {
                setEventName(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('all')}</option>
              {DIAGNOSTIC_EVENTS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="capi-from">{t('from')}</Label>
            <Input
              id="capi-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="capi-to">{t('to')}</Label>
            <Input
              id="capi-to"
              type="date"
              min={from}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {t('refresh')}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t('countsHelp')}</p>
        <div aria-live="polite" className="space-y-3">
          {loading ? (
            <p>{t('loading')}</p>
          ) : error ? (
            <p role="alert">{t('loadError')}</p>
          ) : result?.events.length === 0 ? (
            <p>{t('empty')}</p>
          ) : (
            result?.events.map((event, index) => (
              <MetaConversionEventDiagnostic
                key={event.id ?? index}
                event={event}
                datasetId={result.dataset_id}
              />
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('previous')}
          </Button>
          <span className="text-muted-foreground text-sm">
            {t('page', { page, pages, total: result?.total ?? 0 })}
          </span>
          <Button
            variant="outline"
            disabled={loading || error || page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
