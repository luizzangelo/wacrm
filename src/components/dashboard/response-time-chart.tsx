'use client';

import { Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { durationLabel, WEEKDAY_KEYS } from '@/lib/dashboard/chart-format';
import type { ResponseTimeSummary } from '@/lib/dashboard/types';
import { DashboardBarChart } from './dashboard-bar-chart';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
  error = false,
}: {
  data: ResponseTimeSummary | null;
  loading: boolean;
  thresholdMinutes?: number;
  error?: boolean;
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
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) && (
            <div>
              <div className="text-muted-foreground">
                {t('thisWeek')}{' '}
                <span className="text-foreground font-medium tabular-nums">
                  {durationLabel(data.thisWeekAvg, locale)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {t('lastWeek')}{' '}
                <span className="tabular-nums">
                  {durationLabel(data.lastWeekAvg, locale)}
                </span>
              </div>
            </div>
          )}
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
            rows={WEEKDAY_KEYS.map((key, dow) => ({
              label: t(`weekdays.${key}`),
              value:
                data.buckets.find((b) => b.dow === dow)?.avgMinutes ?? null,
            }))}
            axisFormat={(v) => durationLabel(v, locale, true)}
            tooltipFormat={(v) => durationLabel(v, locale)}
            noSamples={t('noSamples')}
          />
        )}
      </div>
    </section>
  );
}
