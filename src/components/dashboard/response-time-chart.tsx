'use client';

import { Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { durationLabel } from '@/lib/dashboard/chart-format';
import type { ResponseTimeSummary } from '@/lib/dashboard/types';
import { DashboardBarChart } from './dashboard-bar-chart';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

type RangeDays = 7 | 30 | 90;

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
  error = false,
  range,
  onRangeChange,
}: {
  data: ResponseTimeSummary | null;
  loading: boolean;
  thresholdMinutes?: number;
  error?: boolean;
  range: RangeDays;
  onRangeChange: (range: RangeDays) => void;
}) {
  const t = useTranslations('Dashboard.responseTimeChart');
  const locale = useLocale();
  const hasData = data?.buckets.some((b) => b.samples > 0) ?? false;
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
        <div className="flex items-center gap-3 text-right text-xs">
          {thresholdMinutes > 0 && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-700 tabular-nums dark:text-rose-300">
              {t('target', { minutes: thresholdMinutes })}
            </span>
          )}
          {data &&
            (data.currentPeriodAvg != null ||
              data.previousPeriodAvg != null) && (
              <div>
                <div className="text-muted-foreground">
                  {t('currentPeriod')}{' '}
                  <span className="text-foreground font-medium tabular-nums">
                    {durationLabel(data.currentPeriodAvg, locale)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {t('previousPeriod')}{' '}
                  <span className="tabular-nums">
                    {durationLabel(data.previousPeriodAvg, locale)}
                  </span>
                </div>
              </div>
            )}
          <div className="bg-muted/60 flex items-center gap-1 rounded-lg p-1">
            {([7, 30, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={range === days}
                onClick={() => onRangeChange(days)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  range === days
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('days', { count: days })}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="p-5">
        {error ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {t('loadError')}
          </p>
        ) : loading || !data ? (
          <Skeleton className="h-[280px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('noReplies')}
            hint={t('noRepliesHint')}
          />
        ) : (
          <DashboardBarChart
            rows={data.buckets.map((bucket) => ({
              label: formatChartDate(bucket.day, locale),
              value: bucket.avgMinutes,
            }))}
            axisFormat={(v) => durationLabel(v, locale, true)}
            tooltipFormat={(v) => durationLabel(v, locale)}
            noSamples={t('noSamples')}
            xAxisInterval={Math.max(0, Math.ceil(data.buckets.length / 7) - 1)}
          />
        )}
      </div>
    </section>
  );
}

function formatChartDate(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
