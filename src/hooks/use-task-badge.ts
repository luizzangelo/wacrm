'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export function useTaskBadge(): number {
  const { accountId, user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!accountId || !user) return;
    const { data, error } = await createClient().rpc('get_my_task_badge_count');
    if (!error) setCount(Number(data ?? 0));
  }, [accountId, user]);

  useEffect(() => {
    if (!accountId || !user) return;
    // Initial remote synchronization; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const supabase = createClient();
    const channel = supabase
      .channel(`task-badge:${accountId}:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `account_id=eq.${accountId}`,
        },
        () => void refresh()
      )
      .subscribe();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [accountId, user, refresh]);

  return count;
}
