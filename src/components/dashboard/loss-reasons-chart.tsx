'use client';

import { useTranslations } from 'next-intl';
import { LOST_REASONS } from '@/lib/deals/lifecycle';
import type { LossPeriod, LossReasonCount } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';
import { DashboardBarChart } from './dashboard-bar-chart';

export function LossReasonsChart({
  data,
  loading,
  period,
  onPeriodChange,
  error = false,
}: {
  data: LossReasonCount[] | null;
  loading: boolean;
  period: LossPeriod;
  onPeriodChange: (period: LossPeriod) => void;
  error?: boolean;
}) {
  const t = useTranslations('Dashboard.lossReasonsChart');
  const reasons = useTranslations('Pipelines.loss.reasons');
  return (
    <section className="border-border bg-card w-full min-w-0 rounded-xl border">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('description')}
          </p>
        </div>
        <div
          className="bg-muted/60 flex items-center gap-1 rounded-lg p-1"
          role="group"
          aria-label={t('period')}
        >
          {(['day', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => onPeriodChange(p)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                period === p
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(p)}
            </button>
          ))}
        </div>
      </header>
      <div className="p-5">
        {error ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {t('loadError')}
          </p>
        ) : loading || !data ? (
          <Skeleton className="h-[350px] w-full" />
        ) : (
          <DashboardBarChart
            integer
            rows={LOST_REASONS.map((reason) => ({
              label: reasons(reason),
              value: data.find((r) => r.reason === reason)?.count ?? 0,
            }))}
            axisFormat={(v) => String(Math.round(v))}
            tooltipFormat={(v) => t('lostCount', { count: v })}
            noSamples={t('lostCount', { count: 0 })}
          />
        )}
      </div>
    </section>
  );
}
