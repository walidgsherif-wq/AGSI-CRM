'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { AuditRow } from './types';

const EVENT_TYPE_LABEL: Record<string, string> = {
  level_change: 'Level change',
  level_change_approval: 'Level change approval',
  ownership_transfer: 'Ownership transfer',
  credit_auto_dedup: 'Credit auto-dedup',
  engagement_delete: 'Engagement delete',
};

const EVENT_TYPE_VARIANT: Record<
  string,
  'amber' | 'blue' | 'green' | 'red' | 'neutral' | 'purple'
> = {
  level_change: 'blue',
  level_change_approval: 'green',
  ownership_transfer: 'purple',
  credit_auto_dedup: 'amber',
  engagement_delete: 'red',
};

export function AuditEventRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const actorName = pickActor(row.actor);
  const occurred = new Date(row.occurred_at);
  const summary = summarise(row);
  const entityHref = entityLink(row);

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={EVENT_TYPE_VARIANT[row.event_type] ?? 'neutral'}>
            {EVENT_TYPE_LABEL[row.event_type] ?? row.event_type}
          </Badge>
          <span className="text-xs text-agsi-darkGray">
            {occurred.toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          <span className="text-xs text-agsi-darkGray">·</span>
          <span className="text-xs text-agsi-navy">{actorName ?? '(system / unknown)'}</span>
        </div>
        <p className="mt-1 text-sm text-agsi-navy">{summary}</p>
        <p className="mt-0.5 font-mono text-[10px] text-agsi-darkGray">
          {row.entity_type}
          {row.entity_id ? ` · ${row.entity_id}` : ''}
        </p>
      </button>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-3">
          {entityHref && (
            <p className="text-xs">
              <Link
                href={entityHref as never}
                className="text-agsi-accent hover:underline"
              >
                Open {row.entity_type} →
              </Link>
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <JsonBlock label="before" data={row.before_json} />
            <JsonBlock label="after" data={row.after_json} />
          </div>
        </div>
      )}
    </li>
  );
}

function JsonBlock({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown> | null;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <pre className="max-h-64 overflow-auto rounded border border-agsi-lightGray bg-white p-2 text-[11px] text-agsi-navy">
        {data ? JSON.stringify(data, null, 2) : '(none)'}
      </pre>
    </div>
  );
}

function pickActor(
  a: { full_name: string } | { full_name: string }[] | null,
): string | null {
  if (!a) return null;
  if (Array.isArray(a)) return a[0]?.full_name ?? null;
  return a.full_name;
}

/** One-liner summary derived from the row's before/after json. */
function summarise(row: AuditRow): string {
  const before = row.before_json ?? {};
  const after = row.after_json ?? {};

  switch (row.event_type) {
    case 'level_change': {
      const from = (before as { level?: string }).level;
      const to = (after as { level?: string }).level;
      if (from && to) return `${from} → ${to}`;
      return 'Level change';
    }
    case 'level_change_approval': {
      const from = (before as { from?: string }).from;
      const to = (before as { to?: string }).to;
      const decision = (after as { decision?: string }).decision;
      if (from && to && decision) return `${from} → ${to} · ${decision}`;
      return 'Level change request approval';
    }
    case 'ownership_transfer': {
      const fromName = (before as { owner_name?: string }).owner_name;
      const toName = (after as { owner_name?: string }).owner_name;
      if (fromName || toName)
        return `Owner: ${fromName ?? '(unassigned)'} → ${toName ?? '(unassigned)'}`;
      return 'Ownership transfer';
    }
    case 'engagement_delete': {
      const summary = (before as { summary?: string }).summary;
      const type = (before as { engagement_type?: string }).engagement_type;
      if (summary) return `Deleted ${type ?? 'engagement'}: ${truncate(summary, 80)}`;
      return 'Engagement deleted';
    }
    case 'credit_auto_dedup': {
      const reason = (after as { reason?: string }).reason;
      return reason ? `Auto-dedup: ${reason}` : 'Credit auto-dedup';
    }
    default:
      return row.event_type;
  }
}

function entityLink(row: AuditRow): string | null {
  if (!row.entity_id) return null;
  if (row.entity_type === 'company') return `/companies/${row.entity_id}`;
  if (row.entity_type === 'engagement') return null; // engagement is gone after delete; entity_id no longer resolves
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
