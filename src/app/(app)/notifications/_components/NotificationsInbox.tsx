'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  listNotifications,
  markAllRead,
  markRead,
  type NotificationRow,
} from '@/server/actions/notifications';

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

const TYPE_VARIANT: Record<string, 'amber' | 'red' | 'blue' | 'green' | 'neutral'> = {
  stagnation_warning: 'amber',
  stagnation_breach: 'red',
  composition_warning: 'amber',
  composition_drift: 'amber',
  upload_failed: 'red',
  upload_complete: 'green',
  unmatched_company: 'amber',
  leadership_report_finalised: 'blue',
};

const ALL_TYPES = Object.keys(TYPE_LABEL);

export function NotificationsInbox({
  initial,
  initialFilter,
  initialType,
}: {
  initial: NotificationRow[];
  initialFilter: 'all' | 'unread';
  initialType: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<NotificationRow[]>(initial);
  const [pending, startTransition] = useTransition();

  function setQuery(next: { filter?: string; type?: string }) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next.filter !== undefined) sp.set('filter', next.filter);
    if (next.type !== undefined) sp.set('type', next.type);
    router.push(`/notifications?${sp.toString()}` as never);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-agsi-lightGray px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Filter"
            value={initialFilter}
            onChange={(v) => setQuery({ filter: v })}
          >
            <option value="all">All</option>
            <option value="unread">Unread only</option>
          </Select>
          <Select
            label="Type"
            value={initialType}
            onChange={(v) => setQuery({ type: v })}
          >
            <option value="all">All types</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || rows.every((r) => r.is_read)}
          onClick={() => {
            startTransition(async () => {
              await markAllRead();
              const r = await listNotifications({
                filter: initialFilter,
                type: initialType,
                limit: 200,
              });
              setRows(r.rows);
              router.refresh();
            });
          }}
        >
          Mark all read
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-agsi-darkGray">
          No notifications match these filters.
        </p>
      ) : (
        <ul className="divide-y divide-agsi-lightGray">
          {rows.map((n) => (
            <li
              key={n.id}
              className={n.is_read ? 'bg-white' : 'bg-agsi-offWhite'}
            >
              <Row
                n={n}
                onMarkRead={() => {
                  startTransition(async () => {
                    await markRead(n.id);
                    setRows((cur) =>
                      cur.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)),
                    );
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  n,
  onMarkRead,
}: {
  n: NotificationRow;
  onMarkRead: () => void;
}) {
  const variant = TYPE_VARIANT[n.notification_type] ?? 'neutral';
  const typeLabel = TYPE_LABEL[n.notification_type] ?? n.notification_type;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={variant}>{typeLabel}</Badge>
          <span className="text-xs text-agsi-darkGray">
            {new Date(n.created_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {!n.is_read && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-rag-red">
              new
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-agsi-navy">{n.subject}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-xs text-agsi-darkGray">
          {n.body}
        </p>
        {n.link_url && (
          <Link
            href={n.link_url as never}
            onClick={() => {
              if (!n.is_read) onMarkRead();
            }}
            className="mt-1 inline-block text-xs font-medium text-agsi-accent hover:underline"
          >
            Open →
          </Link>
        )}
      </div>
      {!n.is_read && (
        <button
          type="button"
          onClick={onMarkRead}
          className="text-[11px] text-agsi-darkGray hover:underline"
        >
          Mark read
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
