'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import {
  getNotificationSummary,
  markAllRead,
  markRead,
  type NotificationRow,
} from '@/server/actions/notifications';

const POLL_INTERVAL_MS = 60_000;

const TYPE_LABEL: Record<string, string> = {
  stagnation_warning: 'Stagnation warning',
  stagnation_breach: 'Stagnation breach',
  task_due: 'Task due',
  task_overdue: 'Task overdue',
  level_change: 'Level change',
  upload_complete: 'Upload complete',
  upload_failed: 'Upload failed',
  unmatched_company: 'Unmatched company',
  composition_warning: 'Composition warning',
  composition_drift: 'Composition drift',
  mention: 'Mention',
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

  // Initial load + polling.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Refresh when dropdown opens (cheap freshness boost).
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Click-outside closes dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

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
          <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rag-red px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-agsi-lightGray bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-agsi-lightGray px-3 py-2">
            <span className="text-xs font-semibold text-agsi-navy">
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => {
                  startTransition(async () => {
                    await markAllRead();
                    await refresh();
                  });
                }}
                className="text-[11px] font-medium text-agsi-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {recent.length === 0 ? (
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
                        await refresh();
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
              className="text-[11px] font-medium text-agsi-accent hover:underline"
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
  onClickLink,
}: {
  n: NotificationRow;
  onMarkRead: () => void;
  onClickLink: () => void;
}) {
  const typeLabel = TYPE_LABEL[n.notification_type] ?? n.notification_type;

  const inner = (
    <div className="block px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-agsi-darkGray">
          {typeLabel}
        </span>
        <span className="text-[10px] text-agsi-darkGray">
          {timeAgo(n.created_at)}
        </span>
      </div>
      <p className="mt-1 truncate text-xs font-medium text-agsi-navy">
        {n.subject}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-agsi-darkGray">
        {n.body}
      </p>
    </div>
  );

  if (n.link_url) {
    return (
      <Link
        href={n.link_url as never}
        onClick={() => {
          onMarkRead();
          onClickLink();
        }}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onMarkRead}
      className="block w-full text-left"
    >
      {inner}
    </button>
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
