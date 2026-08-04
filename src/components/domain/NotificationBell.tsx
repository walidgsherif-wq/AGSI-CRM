'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import {
  dismissAllNotifications,
  dismissNotification,
  getNotificationSummary,
  markAllRead,
  markRead,
  type NotificationRow,
} from '@/server/actions/notifications';
import {
  notifyUnreadChanged,
  subscribeUnreadChanged,
} from '@/lib/notifications-events';

const POLL_INTERVAL_MS = 60_000;

const TYPE_LABEL: Record<string, string> = {
  stagnation_warning: 'Stagnation warning',
  stagnation_breach: 'Stagnation breach',
  task_due: 'Task due',
  task_overdue: 'Task overdue',
  level_change: 'Level change',
  company_group_request: 'Group request',
  upload_complete: 'Upload complete',
  upload_failed: 'Upload failed',
  unmatched_company: 'Unmatched company',
  composition_warning: 'Composition warning',
  composition_drift: 'Composition drift',
  mention: 'Mention',
  sphere_proposal: 'Sphere proposal',
  claim: 'Claim',
  leadership_report_finalised: 'Leadership report',
};

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [recent, setRecent] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getNotificationSummary();
      setUnread(s.unread);
      setRecent(s.recent);
    } catch {
      // RLS / auth blip — silently ignore; next poll will retry.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Client-side signal: any callsite that mutates unread state fires
  // notifyUnreadChanged(); we subscribe and refetch immediately. This
  // is what makes the badge decrement in real time when the user
  // approves a level change from the /notifications inbox, marks a
  // notification read there, dismisses one from there, etc. — none
  // of which touch the bell's local state directly.
  useEffect(() => {
    return subscribeUnreadChanged(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const hasAny = recent.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-agsi-darkGray hover:bg-agsi-offWhite hover:text-agsi-navy"
        aria-label={`Notifications (${unread} unread)`}
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        Notifications
        {unread > 0 && (
          <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rag-red px-1 text-xxs font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-agsi-lightGray bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-agsi-lightGray px-3 py-2">
            <span className="text-xs font-semibold text-agsi-navy">
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </span>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    startTransition(async () => {
                      await markAllRead();
                      notifyUnreadChanged();
                    });
                  }}
                  className="text-xs2 font-medium text-agsi-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
              {hasAny && (
                <button
                  type="button"
                  onClick={() => {
                    startTransition(async () => {
                      await dismissAllNotifications();
                      notifyUnreadChanged();
                    });
                  }}
                  className="text-xs2 font-medium text-agsi-darkGray hover:text-rag-red hover:underline"
                  title="Hide every notification from this list"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {!hasAny ? (
            <p className="px-3 py-4 text-xs text-agsi-darkGray">
              No notifications yet.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-agsi-lightGray overflow-y-auto">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className={n.is_read ? 'bg-white' : 'bg-agsi-offWhite'}
                >
                  <NotificationItem
                    n={n}
                    onMarkRead={() => {
                      startTransition(async () => {
                        await markRead(n.id);
                        notifyUnreadChanged();
                      });
                    }}
                    onDismiss={() => {
                      startTransition(async () => {
                        await dismissNotification(n.id);
                        notifyUnreadChanged();
                      });
                    }}
                    onClickLink={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-agsi-lightGray px-3 py-2 text-center">
            <Link
              href={'/notifications' as never}
              onClick={() => setOpen(false)}
              className="text-xs2 font-medium text-agsi-accent hover:underline"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  n,
  onMarkRead,
  onDismiss,
  onClickLink,
}: {
  n: NotificationRow;
  onMarkRead: () => void;
  onDismiss: () => void;
  onClickLink: () => void;
}) {
  const typeLabel = TYPE_LABEL[n.notification_type] ?? n.notification_type;

  const body = (
    <div className="block px-3 py-2 pr-7">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xxs font-semibold uppercase tracking-wide text-agsi-darkGray">
          {typeLabel}
        </span>
        <span className="text-xxs text-agsi-darkGray">
          {timeAgo(n.created_at)}
        </span>
      </div>
      <p className="mt-1 truncate text-xs font-medium text-agsi-navy">
        {n.subject}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs2 text-agsi-darkGray">
        {n.body}
      </p>
    </div>
  );

  // Dismiss × is absolutely positioned so it sits inside the row but
  // outside the Link/button — clicking it never navigates.
  const dismissBtn = (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        onDismiss();
      }}
      aria-label="Dismiss notification"
      title="Dismiss"
      className="absolute right-1.5 top-1.5 rounded p-1 text-agsi-midGray hover:bg-agsi-offWhite hover:text-rag-red"
    >
      <X className="h-3 w-3" aria-hidden />
    </button>
  );

  if (n.link_url) {
    return (
      <div className="relative">
        <Link
          href={n.link_url as never}
          onClick={() => {
            onMarkRead();
            onClickLink();
          }}
        >
          {body}
        </Link>
        {dismissBtn}
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onMarkRead}
        className="block w-full text-left"
      >
        {body}
      </button>
      {dismissBtn}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
