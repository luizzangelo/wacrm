'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { loadLossReasons } from '@/lib/dashboard/queries';
import type { LossPeriod, LossReasonCount } from '@/lib/dashboard/types';

export function useDashboardLossReasons(accountId: string | null) {
  const [period, setPeriod] = useState<LossPeriod>('month');
  const [data, setData] = useState<LossReasonCount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const invalidate = useCallback(() => {
    ++request.current;
  }, []);
  const load = useCallback(
    async (selected: LossPeriod) => {
      const version = ++request.current;
      setLoading(true);
      setError(false);
      setData(null);
      if (!accountId) {
        setLoading(false);
        return;
      }
      try {
        const result = await loadLossReasons(
          createClient(),
          accountId,
          selected
        );
        if (request.current === version) setData(result);
      } catch {
        if (request.current === version) setError(true);
      } finally {
        if (request.current === version) setLoading(false);
      }
    },
    [accountId]
  );
  useEffect(() => {
    let active = true;
    // Defer initial state changes; cancel in-flight reads on unmount/account change.
    void Promise.resolve().then(() => {
      if (active) {
        setPeriod('month');
        void load('month');
      }
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [load, invalidate]);
  const onPeriodChange = useCallback(
    (selected: LossPeriod) => {
      setPeriod(selected);
      void load(selected);
    },
    [load]
  );
  return { data, loading, error, period, onPeriodChange };
}
