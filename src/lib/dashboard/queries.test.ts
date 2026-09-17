import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadLossReasons, loadResponseTime } from './queries';
import { LOST_REASONS } from '@/lib/deals/lifecycle';
describe('bounded server aggregates, explicit account scope', () => {
  it.each(['day', 'week', 'month'] as const)(
    'loss period %s requests only the scoped RPC',
    async (period) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [
          { reason: 'price', count: 2 },
          { reason: 'invalid', count: 100 },
        ],
        error: null,
      });
      const rows = await loadLossReasons(
        { rpc } as unknown as SupabaseClient,
        'account',
        period
      );
      expect(rpc).toHaveBeenCalledWith('dashboard_loss_reasons', {
        p_account_id: 'account',
        p_period: period,
      });
      expect(rows.map((r) => r.reason)).toEqual(LOST_REASONS);
      expect(rows[0].count).toBe(2);
      expect(rows.slice(1).every((r) => r.count === 0)).toBe(true);
    }
  );
  it('loss errors never become fabricated zeros', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error('failure') });
    await expect(
      loadLossReasons({ rpc } as unknown as SupabaseClient, 'account', 'day')
    ).rejects.toThrow('failure');
  });
  it('response uses numeric minutes without conversion and Sunday-first server order', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          dow: 0,
          avg_minutes: 624,
          samples: 2,
          this_week_avg: 624,
          last_week_avg: 5,
        },
        {
          dow: 1,
          avg_minutes: null,
          samples: 0,
          this_week_avg: 624,
          last_week_avg: 5,
        },
      ],
      error: null,
    });
    const result = await loadResponseTime(
      { rpc } as unknown as SupabaseClient,
      'account'
    );
    expect(rpc).toHaveBeenCalledWith('dashboard_response_time', {
      p_account_id: 'account',
    });
    expect(result).toEqual({
      buckets: [
        { dow: 0, avgMinutes: 624, samples: 2 },
        { dow: 1, avgMinutes: null, samples: 0 },
      ],
      thisWeekAvg: 624,
      lastWeekAvg: 5,
    });
  });
  it('response query error is propagated', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error('failure') });
    await expect(
      loadResponseTime({ rpc } as unknown as SupabaseClient, 'account')
    ).rejects.toThrow('failure');
  });
});
