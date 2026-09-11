'use client';

import { AlertCircle, Loader2, Megaphone } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/dashboard/skeleton';
import { Badge } from '@/components/ui/badge';
import type { MetaAdAttributionView } from '@/lib/meta-conversions/attribution-view';

interface MetaAdsAttributionCardProps {
  attribution: MetaAdAttributionView | null;
  loading?: boolean;
  context?: 'contact' | 'deal_fixed' | 'contact_preview';
}

function AttributionLevel({
  label,
  name,
  id,
}: {
  label: string;
  name: string | null;
  id: string | null;
}) {
  if (!name && !id) return null;

  return (
    <div className="border-border/60 bg-background/50 min-w-0 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>
      {name && (
        <p
          className="text-foreground mt-0.5 truncate text-sm font-medium"
          title={name}
        >
          {name}
        </p>
      )}
      {id && (
        <p className="text-muted-foreground mt-0.5 text-[11px] break-all">
          ID: {id}
        </p>
      )}
    </div>
  );
}

export function MetaAdsAttributionCard({
  attribution,
  loading = false,
  context = 'contact',
}: MetaAdsAttributionCardProps) {
  const t = useTranslations('MetaAdsAttribution');
  const format = useFormatter();

  if (loading) {
    return (
      <section
        aria-label={t('title')}
        data-meta-attribution-loading="true"
        className="border-border bg-muted/30 space-y-3 rounded-lg border p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-3 w-40" />
      </section>
    );
  }

  if (!attribution) return null;

  return (
    <section className="border-border bg-muted/30 space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone
              className="text-primary size-4 shrink-0"
              aria-hidden="true"
            />
            <h3 className="text-foreground text-sm font-semibold">
              {t('title')}
            </h3>
          </div>
          {context === 'deal_fixed' && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t('dealFixed')}
            </p>
          )}
          {context === 'contact_preview' && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t('contactPreview')}
            </p>
          )}
        </div>
        <Badge variant="secondary">{t('badge')}</Badge>
      </div>

      {attribution.enrichment_status === 'enriched' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <AttributionLevel
            label={t('campaign')}
            name={attribution.campaign_name}
            id={attribution.campaign_id}
          />
          <AttributionLevel
            label={t('adSet')}
            name={attribution.adset_name}
            id={attribution.adset_id}
          />
          <AttributionLevel
            label={t('ad')}
            name={attribution.ad_name}
            id={attribution.ad_id}
          />
        </div>
      )}

      {attribution.enrichment_status === 'pending' && (
        <div className="bg-background/50 text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 text-xs">
          <Loader2
            className="size-3.5 shrink-0 animate-spin"
            aria-hidden="true"
          />
          <span>{t('pending')}</span>
        </div>
      )}

      {attribution.enrichment_status === 'failed' && (
        <div className="bg-background/50 text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 text-xs">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('failed')}</span>
        </div>
      )}

      <p className="text-muted-foreground text-[11px]">
        {t('recordedAt', {
          date: format.dateTime(new Date(attribution.received_at), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </p>
    </section>
  );
}
