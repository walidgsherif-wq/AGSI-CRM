'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  dismissAllNotifications,
  dismissNotification,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationRow,
} from '@/server/actions/notifications';
import { ReviewActions } from '@/app/(app)/admin/level-requests/_components/ReviewActions';
import type { Level, Role } from '@/types/domain';

const TYPE_LABEL: Record<string, string> = {
  stagnation_warning: 'Stagnation warning',
  stagnation_breach: 'Stagnation breach',
  task_due: 'Task due',
  task_overdue: 'Task overdue',
  task_assigned: 'Task assigned',
  level_change: 'Level change',
  company_group_request: 'Group request',
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
  task_assigned: 'blue',
  company_group_request: 'amber',
};

const ALL_TYPES = Object.keys(TYPE_LABEL);

/** Per-notification enrichment fetched server-side. */
export type LevelChangeContext = {
  request_id: string;
  from_level: Level;
  to_level: Level;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  evidence_note: string;
  company_id: string;
  company_name: string;
  company_type_label: string;
  requester_name: string;
};

export function NotificationsInbox({
  initial,
  initialFilter,
  initialType,
  levelChangeContext,
  viewerRole,
}: {
  initial: NotificationRow[];
  initialFilter: 'all' | 'unread';
  initialType: string;
  /** Keyed by notification.id. Populated server-side for level_change rows. */
  levelChangeContext?: Record<string, LevelChangeContext>;
  viewerRole: Role;
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

  async function reload() {
    const r = await listNotifications({
      filter: initialFilter,
      type: initialType,
      limit: 200,
    });
    setRows(r.rows);
    router.refresh();
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
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || rows.every((r) => r.is_read)}
            onClick={() => {
              startTransition(async () => {
                await markAllRead();
                await reload();
              });
            }}
          >
            Mark all read
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || rows.length === 0}
            onClick={() => {
              startTransition(async () => {
                await dismissAllNotifications();
                await reload();
              });
            }}
          >
            Clear all
          </Button>
        </div>
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
                lc={levelChangeContext?.[n.id]}
                viewerRole={viewerRole}
                onMarkRead={() => {
                  startTransition(async () => {
                    await markRead(n.id);
                    setRows((cur) =>
                      cur.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)),
                    );
                  });
                }}
                onDismiss={() => {
                  startTransition(async () => {
                    await dismissNotification(n.id);
                    setRows((cur) => cur.filter((r) => r.id !== n.id));
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
  lc,
  viewerRole,
  onMarkRead,
  onDismiss,
}: {
  n: NotificationRow;
  lc?: LevelChangeContext;
  viewerRole: Role;
  onMarkRead: () => void;
  onDismiss: () => void;
}) {
  const variant = TYPE_VARIANT[n.notification_type] ?? 'neutral';
  const typeLabel = TYPE_LABEL[n.notification_type] ?? n.notification_type;

  const isLevelChange = n.notification_type === 'level_change' && lc;
  const canReview =
    isLevelChange &&
    lc!.status === 'pending' &&
    (viewerRole === 'admin' || viewerRole === 'bd_head');

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={variant}>{typeLabel}</Badge>
          <span className="text-xs text-agsi-darkGray">
            {new Date(n.created_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {!n.is_read && (
            <span className="text-xxs font-semibold uppercase tracking-wide text-rag-red">
              new
            </span>
          )}
        </div>

        {isLevelChange ? (
          <LevelChangeBody n={n} lc={lc!} canReview={canReview!} />
        ) : (
          <>
            <p className="text-sm font-medium text-agsi-navy">{n.subject}</p>
            <p className="whitespace-pre-wrap text-xs text-agsi-darkGray">{n.body}</p>
          </>
        )}

        {n.link_url && (
          <Link
            href={n.link_url as never}
            onClick={() => {
              if (!n.is_read) onMarkRead();
            }}
            className="inline-block text-xs font-medium text-agsi-accent hover:underline"
          >
            Open →
          </Link>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {!n.is_read && (
          <button
            type="button"
            onClick={onMarkRead}
            className="text-xs2 text-agsi-darkGray hover:underline"
          >
            Mark read
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss notification"
          className="inline-flex items-center gap-1 rounded p-1 text-xs2 text-agsi-midGray hover:text-rag-red"
        >
          <X className="h-3 w-3" aria-hidden /> Dismiss
        </button>
      </div>
    </div>
  );
}

function LevelChangeBody({
  n,
  lc,
  canReview,
}: {
  n: NotificationRow;
  lc: LevelChangeContext;
  canReview: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-medium text-agsi-navy">
          {lc.company_name}
        </p>
        <span className="text-xs text-agsi-darkGray">· {lc.company_type_label}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="amber">
          {lc.from_level} → {lc.to_level}
        </Badge>
        <span className="text-xs capitalize text-agsi-darkGray">
          {lc.status}
        </span>
        <span className="text-xs text-agsi-darkGray">
          · requested by {lc.requester_name}
        </span>
      </div>

      <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite px-3 py-2">
        <p className="text-xxs font-semibold uppercase tracking-wider text-agsi-darkGray">
          Justification
        </p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-agsi-navy">
          {lc.evidence_note?.trim() || (
            <span className="text-agsi-midGray">No justification provided.</span>
          )}
        </p>
      </div>

      {/* Fallback for non-actionable level-change rows: still surface */}
      {/* the original system body in muted text so review notes land */}
      {/* somewhere visible. */}
      {!canReview && n.body && (
        <p className="whitespace-pre-wrap text-xs text-agsi-darkGray">
          {n.body}
        </p>
      )}

      {canReview && (
        <div className="rounded-lg border border-agsi-lightGray bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-agsi-navy">
            Review this request
          </p>
          <ReviewActions requestId={lc.request_id} />
        </div>
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
