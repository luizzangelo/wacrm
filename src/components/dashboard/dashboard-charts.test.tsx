// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import pt from '../../../messages/pt-BR.json';
import en from '../../../messages/en.json';
import ko from '../../../messages/ko.json';
import { LossReasonsChart } from './loss-reasons-chart';
import { ResponseTimeChart } from './response-time-chart';
import { useDashboardLossReasons } from '@/hooks/use-dashboard-loss-reasons';
import { LOST_REASONS } from '@/lib/deals/lifecycle';
import type { ResponseTimeSummary } from '@/lib/dashboard/types';
import { BarChart as LegacyBarChart } from '@/components/tremor/bar-chart';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
// Only container measurement is substituted; actual Recharts axes/bars render.
vi.mock('recharts', async (original) => {
  const actual = await original<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, {
        width: 1400,
        height: 350,
      } as React.Attributes),
  };
});
afterEach(() => {
  cleanup();
  rpc.mockReset();
});
const locales = { 'pt-BR': pt, en, ko };
function wrap(
  children: React.ReactNode,
  locale: keyof typeof locales = 'pt-BR'
) {
  return (
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
const data: ResponseTimeSummary = {
  buckets: Array.from({ length: 7 }, (_, dow) => ({
    dow,
    avgMinutes: dow === 0 ? 624 : dow === 1 ? 68 : null,
    samples: dow < 2 ? 1 : 0,
  })),
  thisWeekAvg: 346,
  lastWeekAvg: 3,
};
function LossHarness() {
  const losses = useDashboardLossReasons('account-fixture');
  return <LossReasonsChart {...losses} />;
}
describe('loss chart: real Recharts, i18n, periods and zeros', () => {
  it('month is selected initially; each switch refetches the appropriate bounded aggregate', async () => {
    rpc.mockImplementation((_name: string, params: { p_period: string }) =>
      Promise.resolve({
        data: [{ reason: 'price', count: params.p_period === 'day' ? 1 : 8 }],
        error: null,
      })
    );
    render(wrap(<LossHarness />));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('dashboard_loss_reasons', {
        p_account_id: 'account-fixture',
        p_period: 'month',
      })
    );
    expect(
      screen.getByRole('button', { name: 'Mês' }).getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith('dashboard_loss_reasons', {
        p_account_id: 'account-fixture',
        p_period: 'day',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith('dashboard_loss_reasons', {
        p_account_id: 'account-fixture',
        p_period: 'week',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText('Preço')).toBeTruthy());
  });
  it.each(Object.keys(locales) as (keyof typeof locales)[])(
    'all nine localized reasons render in order, including zeros: %s',
    async (locale) => {
      const { container } = render(
        wrap(
          <LossReasonsChart
            data={[]}
            loading={false}
            period="month"
            onPeriodChange={vi.fn()}
          />,
          locale
        )
      );
      await waitFor(() =>
        expect(
          [
            ...container.querySelectorAll(
              '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'
            ),
          ].map((n) => n.textContent?.trim())
        ).toEqual(
          LOST_REASONS.map((r) => locales[locale].Pipelines.loss.reasons[r])
        )
      );
      const labels = [
        ...container.querySelectorAll(
          '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'
        ),
      ].map((n) => n.textContent?.trim());
      expect(labels).toEqual(
        LOST_REASONS.map((r) => locales[locale].Pipelines.loss.reasons[r])
      );
      const ticks = [
        ...container.querySelectorAll(
          '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
        ),
      ].map((n) => n.textContent);
      expect(ticks).toEqual(['0', '1']);
      expect(container.querySelector('section')?.className).toContain('w-full');
      expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
      expect(container.querySelector('section')?.className).toContain(
        'bg-card'
      );
    }
  );
  it('load error is visible, not an endless skeleton or fabricated zero chart', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'failure' } });
    render(wrap(<LossHarness />));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it.each([1, 8])('tooltip pluralizes %s lost leads', async (count) => {
    const { container } = render(
      wrap(
        <LossReasonsChart
          data={[{ reason: 'price', count }]}
          loading={false}
          period="month"
          onPeriodChange={vi.fn()}
        />
      )
    );
    const svg = container.querySelector('svg')!;
    fireEvent.focus(svg);
    expect(
      await screen.findByText(
        count === 1 ? '1 lead perdido' : '8 leads perdidos'
      )
    ).toBeTruthy();
  });
  it('a stale response cannot replace the newly selected period', async () => {
    let finishMonth!: (v: unknown) => void;
    rpc.mockImplementation((_n: string, p: { p_period: string }) =>
      p.p_period === 'month'
        ? new Promise((resolve) => {
            finishMonth = resolve;
          })
        : Promise.resolve({
            data: [{ reason: 'price', count: 1 }],
            error: null,
          })
    );
    render(wrap(<LossHarness />));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    await waitFor(() => expect(screen.getByText('Preço')).toBeTruthy());
    finishMonth({ data: [{ reason: 'price', count: 1000 }], error: null });
    await waitFor(() => expect(screen.queryByText('1000')).toBeNull());
  });
});
describe('response chart: actual axes, summaries and locale', () => {
  it.each(Object.keys(locales) as (keyof typeof locales)[])(
    'Sunday-first localized ticks and correct duration axis: %s',
    async (locale) => {
      const { container } = render(
        wrap(<ResponseTimeChart data={data} loading={false} />, locale)
      );
      await waitFor(() =>
        expect(
          [
            ...container.querySelectorAll(
              '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'
            ),
          ].map((n) => n.textContent)
        ).toEqual(
          Object.values(locales[locale].Dashboard.responseTimeChart.weekdays)
        )
      );
      const labels = [
        ...container.querySelectorAll(
          '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'
        ),
      ].map((n) => n.textContent);
      expect(labels).toEqual(
        Object.values(locales[locale].Dashboard.responseTimeChart.weekdays)
      );
      const ticks = [
        ...container.querySelectorAll(
          '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
        ),
      ].map((n) => n.textContent);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(ticks.join()).not.toContain('0.0m');
      expect(
        ticks.some((t) => t?.includes(locale === 'ko' ? '시간' : 'h'))
      ).toBe(true);
      if (locale === 'pt-BR') expect(screen.queryByText('Mon')).toBeNull();
      expect(container.querySelector('section')?.className).toContain('w-full');
    }
  );
  it('weekly weighted values share duration formatter and retain 5-minute target', () => {
    render(wrap(<ResponseTimeChart data={data} loading={false} />));
    expect(screen.getByText('5h 46min')).toBeTruthy();
    expect(screen.getByText('3 min')).toBeTruthy();
    expect(screen.getByText('meta 5min')).toBeTruthy();
  });
  it('empty current week shows the existing empty state, not a false zero mean', () => {
    const empty = {
      ...data,
      buckets: data.buckets.map((b) => ({
        ...b,
        avgMinutes: null,
        samples: 0,
      })),
      thisWeekAvg: null,
    };
    render(wrap(<ResponseTimeChart data={empty} loading={false} />));
    expect(screen.getByText('Nenhuma resposta registrada ainda')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
  it('real zero observations still render stable axes', async () => {
    const zero = {
      ...data,
      buckets: data.buckets.map((b) => ({ ...b, avgMinutes: 0, samples: 1 })),
      thisWeekAvg: 0,
    };
    const { container } = render(
      wrap(<ResponseTimeChart data={zero} loading={false} />)
    );
    await waitFor(() =>
      expect(
        container.querySelectorAll(
          '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
        )
      ).toHaveLength(2)
    );
    expect(screen.queryByText('Nenhuma resposta registrada ainda')).toBeNull();
  });
  it('legacy formatter rounds positive subminute ticks to misleading 0.0m', async () => {
    const { container } = render(
      <LegacyBarChart
        data={[{ day: 'Mon', 'Avg minutes': 0.04 }]}
        index="day"
        categories={['Avg minutes']}
        valueFormatter={(v) => `${v.toFixed(1)}m`}
        showLegend={false}
      />
    );
    await waitFor(() =>
      expect(
        [
          ...container.querySelectorAll(
            '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
          ),
        ].filter((n) => n.textContent === '0.0m').length
      ).toBeGreaterThan(1)
    );
    const ticks = [
      ...container.querySelectorAll(
        '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
      ),
    ].map((n) => n.textContent);
    expect(ticks.filter((t) => t === '0.0m').length).toBeGreaterThan(1);
  });
});
