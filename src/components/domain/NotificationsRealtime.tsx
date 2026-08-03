'use client';

import { useEffect, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { notifyUnreadChanged } from '@/lib/notifications-events';

const DEBOUNCE_MS = 500;

/**
 * One realtime channel per session, subscribed to the current user's
 * own notifications only (RLS + server-side filter both scope; the
 * filter avoids receiving anything RLS would drop anyway). Any
 * INSERT / UPDATE on the row fires the shared client bus
 * (notifications-events.ts) — which is what NotificationBell,
 * ActionQueuePanel, the discussion-rail badge, and every other
 * bus subscriber already listen to. One dispatch → all fan-out.
 *
 *   - Debounced: burst-writes (approve → INSERT + auto-resolve
 *     UPDATE on a related row within milliseconds) collapse into
 *     a single refetch, not one per event.
 *   - Focus safety net: if the socket drops or the tab was
 *     backgrounded, refocusing fires one refetch. Cheap insurance
 *     kept on even when realtime is healthy — the debounce means
 *     a stray refocus while a realtime tick is in flight costs
 *     nothing.
 *   - Cleanup: unmount removes the channel + focus listener.
 *
 * Dev-mode note: getCurrentUser can return synthetic ids like
 * `dev-admin` (see get-user.ts). The realtime filter will match
 * nothing for those (no rows have that recipient_id) — that's fine,
 * the polling + focus safety net still deliver refreshes.
 */
export function NotificationsRealtime({
  currentUserId,
}: {
  currentUserId: string;
}) {
  // Keep the debounce timer and last-fire timestamp across renders.
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Fire the shared bus event — subscribers on this same tab
    // refetch. Wrapped in the ref-tracked debounce so a burst of
    // realtime events (INSERT + UPDATE within a few ms) collapses.
    function schedule() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        notifyUnreadChanged();
      }, DEBOUNCE_MS);
    }

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`notifications:mine:${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${currentUserId}`,
        },
        schedule,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${currentUserId}`,
        },
        schedule,
      )
      .subscribe();

    // Focus safety net — one refetch on tab regain-focus. Handles
    // dropped-socket cases and the "was away for lunch" case where
    // browsers throttle background sockets.
    function onFocus() {
      schedule();
    }
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return null;
}
