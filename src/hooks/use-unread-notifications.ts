"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";
import {useAuth} from './use-auth';

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * Reads and realtime require both membership and recipient identity.
 */
export function useUnreadNotifications(): number {
  const {accountId,user} = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!accountId || !user) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: unreadCount, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq('account_id',accountId).eq('user_id',user.id)
        .is("read_at", null);
      if (cancelled || error) return;
      setCount(unreadCount ?? 0);
    })();

    const channel = supabase
      .channel("notifications-unread-count")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter:`account_id=eq.${accountId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            if (row.account_id!==accountId || row.user_id!==user.id) return;
            if (!row.read_at) setCount((n) => n + 1);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter:`account_id=eq.${accountId}` },
        (payload) => {
            // Updates here only ever set read_at (marking a notification
            // read). Derive purely from the new row so we don't rely on
            // payload.old columns, which require REPLICA IDENTITY FULL.
            const newRow = payload.new as Notification;
            if (newRow.account_id!==accountId || newRow.user_id!==user.id) return;
            if (newRow.read_at) setCount((n) => Math.max(0, n - 1));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId,user]);

  return count;
}
