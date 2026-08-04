'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { AuditRow } from './types';

const EVENT_TYPE_LABEL: Record<string, string> = {
  app_setting_change: 'App setting change',
  company_claimed: 'Company claimed',
  company_group_approved: 'Group approved',
  company_merged: 'Company merged',
  company_unclaimed: 'Company unclaimed',
  contact_archived: 'Contact archived',
  contact_created: 'Contact created',
  contact_purged: 'Contact purged',
  contact_restored: 'Contact restored',
  contact_updated: 'Contact updated',
  credit_auto_dedup: 'Credit auto-dedup',
  ecosystem_point_change: 'Point value change',
  engagement_delete: 'Engagement delete',
  feature_access_change: 'Feature access change',
  level_change: 'Level change',
  level_change_approval: 'Level change approval',
  level_initial_backfill: 'Initial level backfill',
  ownership_transfer: 'Ownership transfer',
  stagnation_rule_change: 'Stagnation rule change',
};

const EVENT_TYPE_VARIANT: Record<
  string,
  'amber' | 'blue' | 'green' | 'red' | 'neutral' | 'purple'
> = {
  app_setting_change: 'neutral',
  company_claimed: 'green',
  company_group_approved: 'blue',
  company_merged: 'purple',
  company_unclaimed: 'amber',
  contact_archived: 'amber',
  contact_created: 'green',
  contact_purged: 'red',
  contact_restored: 'green',
  contact_updated: 'neutral',
  credit_auto_dedup: 'amber',
  ecosystem_point_change: 'neutral',
  engagement_delete: 'red',
  feature_access_change: 'neutral',
  level_change: 'blue',
  level_change_approval: 'green',
  level_initial_backfill: 'blue',
  ownership_transfer: 'purple',
  stagnation_rule_change: 'neutral',
};

export function AuditEventRow({
  row,
  entityDisplayName,
}: {
  row: AuditRow;
  /** Resolved human name for the entity (e.g. company canonical_name,
   *  profile full_name). When omitted, the row falls back to the raw
   *  UUID — types like level_change_request or engagement don't have a
   *  cheap resolver yet. */
  entityDisplayName?: string;
}) {
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
        {/* Entity line: prefer the resolved display name over the raw
            UUID so "Arada" reads as "Arada", not a 36-char id. UUID is
            kept in the expanded panel below via the JSON blocks and
            the "Open" link, so investigators still get the anchor. */}
        <p className="mt-0.5 text-xxs text-agsi-darkGray">
          {row.entity_type}
          {row.entity_id ? (
            <>
              {' · '}
              {entityDisplayName ? (
                <span className="text-agsi-navy">{entityDisplayName}</span>
              ) : (
                <span className="font-mono">{row.entity_id}</span>
              )}
            </>
          ) : (
            ''
          )}
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
          {row.entity_id && (
            <p className="font-mono text-xxs text-agsi-darkGray">
              {row.entity_type} · {row.entity_id}
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
      <p className="mb-1 text-xxs font-semibold uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <pre className="max-h-64 overflow-auto rounded border border-agsi-lightGray bg-white p-2 text-xs2 text-agsi-navy">
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

/**
 * One-liner summary derived from the row's before/after json. Every
 * event_type produced by any migration site should surface something
 * more useful than the bare string here. When the JSON shape drifts
 * (columns added / renamed), the sub-branches fall through to the
 * event's own label so the row never renders blank.
 */
function summarise(row: AuditRow): string {
  const before = (row.before_json ?? {}) as Record<string, unknown>;
  const after = (row.after_json ?? {}) as Record<string, unknown>;

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
      const source = (after as { source?: string }).source;
      const backfill = (before as { is_backfill?: boolean }).is_backfill;
      const parts: string[] = [];
      if (from && to) parts.push(`${from} → ${to}`);
      if (source) parts.push(source);
      if (backfill) parts.push('backfill');
      return parts.length > 0
        ? parts.join(' · ')
        : 'Level change request approved';
    }
    case 'level_initial_backfill': {
      const from = (before as { level?: string }).level;
      const to = (after as { level?: string }).level;
      const note = (after as { note?: string }).note;
      const head = from && to ? `${from} → ${to}` : 'Initial level';
      return note ? `${head} · ${truncate(note, 60)}` : head;
    }
    case 'ownership_transfer': {
      const oldId = (before as { old_owner_id?: string | null }).old_owner_id;
      const newId = (before as { new_owner_id?: string | null }).new_owner_id;
      const credit = (after as { transfer_credit?: boolean }).transfer_credit;
      const rows = (after as { history_rows_reattributed?: number })
        .history_rows_reattributed;
      const parts: string[] = [];
      if (oldId !== undefined || newId !== undefined) {
        parts.push(
          `Owner: ${shortId(oldId) ?? '(unassigned)'} → ${
            shortId(newId) ?? '(unassigned)'
          }`,
        );
      }
      if (credit !== undefined)
        parts.push(credit ? 'with credit' : 'no credit');
      if (typeof rows === 'number' && rows > 0)
        parts.push(`${rows} history row${rows === 1 ? '' : 's'}`);
      return parts.length > 0 ? parts.join(' · ') : 'Ownership transfer';
    }
    case 'company_claimed': {
      const owner = (after as { owner_id?: string | null }).owner_id;
      const role = (after as { claimed_by_role?: string }).claimed_by_role;
      const parts: string[] = ['Claimed'];
      if (role) parts.push(`by ${role}`);
      if (owner) parts.push(`(${shortId(owner) ?? owner})`);
      return parts.join(' ');
    }
    case 'company_unclaimed': {
      const reason = (after as { reason?: string }).reason;
      const role = (after as { released_by_role?: string }).released_by_role;
      const head = role ? `Unclaimed by ${role}` : 'Unclaimed';
      return reason ? `${head} · ${truncate(reason, 80)}` : head;
    }
    case 'company_merged': {
      const survivor = (after as { survivor_id?: string }).survivor_id;
      const snapshot = (before as { absorbed_snapshot?: { canonical_name?: string } })
        .absorbed_snapshot;
      const absorbedName = snapshot?.canonical_name;
      const parts: string[] = [];
      if (absorbedName) parts.push(`Merged "${absorbedName}"`);
      if (survivor) parts.push(`into ${shortId(survivor) ?? survivor}`);
      return parts.length > 0 ? parts.join(' ') : 'Company merged';
    }
    case 'company_group_approved': {
      const updated = (after as { updated_count?: number }).updated_count;
      const note = (after as { review_note?: string | null }).review_note;
      const head =
        typeof updated === 'number'
          ? `${updated} child compan${updated === 1 ? 'y' : 'ies'} grouped`
          : 'Group approved';
      return note ? `${head} · ${truncate(note, 60)}` : head;
    }
    case 'engagement_delete': {
      const summary = (before as { summary?: string }).summary;
      const type = (before as { engagement_type?: string }).engagement_type;
      if (summary)
        return `Deleted ${type ?? 'engagement'}: ${truncate(summary, 80)}`;
      return type ? `Deleted ${type}` : 'Engagement deleted';
    }
    case 'credit_auto_dedup': {
      const reason = (after as { reason?: string }).reason;
      return reason ? `Auto-dedup: ${reason}` : 'Credit auto-dedup';
    }
    case 'feature_access_change': {
      const feature = (before as { feature?: string }).feature;
      const wasAllowed = (before as { allowed?: boolean | null }).allowed;
      const nowAllowed = (after as { allowed?: boolean | null }).allowed;
      const head = feature ? `Feature "${feature}"` : 'Feature access';
      const arrow = `${fmtAllowed(wasAllowed)} → ${fmtAllowed(nowAllowed)}`;
      return `${head}: ${arrow}`;
    }
    case 'app_setting_change': {
      const key = (after as { key?: string }).key;
      return key ? `Setting "${key}" changed` : 'App setting changed';
    }
    case 'stagnation_rule_change': {
      const level = (after as { level?: string }).level;
      const days = (after as { max_days_in_level?: number })
        .max_days_in_level;
      const active = (after as { is_active?: boolean }).is_active;
      const parts: string[] = [];
      if (level) parts.push(`Level ${level}`);
      if (typeof days === 'number') parts.push(`${days}d`);
      if (typeof active === 'boolean') parts.push(active ? 'active' : 'off');
      return parts.length > 0
        ? `Stagnation rule: ${parts.join(' · ')}`
        : 'Stagnation rule changed';
    }
    case 'ecosystem_point_change': {
      const cat = (after as { event_category?: string }).event_category;
      const sub = (after as { event_subtype?: string }).event_subtype;
      const wasPts = (before as { points_current?: number }).points_current;
      const nowPts = (after as { points_current?: number }).points_current;
      const head = cat && sub ? `${cat} / ${sub}` : 'Points';
      if (typeof wasPts === 'number' && typeof nowPts === 'number') {
        return `${head}: ${wasPts} → ${nowPts}`;
      }
      return `${head} changed`;
    }
    case 'contact_created': {
      const name = (after as { full_name?: string | null }).full_name;
      const email = (after as { email?: string | null }).email;
      return `Created ${name ?? email ?? 'contact'}`;
    }
    case 'contact_purged': {
      const name = (before as { full_name?: string | null }).full_name;
      const email = (before as { email?: string | null }).email;
      return `Purged ${name ?? email ?? 'contact'}`;
    }
    case 'contact_archived': {
      const name = (after as { full_name?: string | null }).full_name;
      return name ? `Archived ${name}` : 'Contact archived';
    }
    case 'contact_restored': {
      const name = (after as { full_name?: string | null }).full_name;
      return name ? `Restored ${name}` : 'Contact restored';
    }
    case 'contact_updated': {
      const name = (after as { full_name?: string | null }).full_name;
      const changed = diffKeys(before, after);
      const head = name ? `Updated ${name}` : 'Contact updated';
      return changed.length > 0
        ? `${head} · ${changed.slice(0, 3).join(', ')}`
        : head;
    }
    default:
      return row.event_type;
  }
}

function entityLink(row: AuditRow): string | null {
  if (!row.entity_id) return null;
  if (row.entity_type === 'company') return `/companies/${row.entity_id}`;
  if (row.entity_type === 'contact') {
    // Contacts live under their company — jump straight to the
    // stakeholder's contacts tab. When the audit row has a company
    // stored on before/after, prefer that; otherwise skip the link
    // (the raw contact id doesn't route anywhere on its own).
    const co =
      ((row.after_json ?? {}) as { company_id?: string }).company_id ??
      ((row.before_json ?? {}) as { company_id?: string }).company_id;
    return co ? `/companies/${co}/contacts` : null;
  }
  // feature_access rows carry a user id — jump to that user's access
  // editor so the admin can see the current allow/deny state.
  if (row.entity_type === 'feature_access')
    return `/admin/users/${row.entity_id}/access`;
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** First 8 chars of a UUID with an ellipsis — enough to eyeball
 *  identity without dominating the summary line. */
function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return `${id.slice(0, 8)}…`;
}

function fmtAllowed(v: boolean | null | undefined): string {
  if (v === true) return 'allowed';
  if (v === false) return 'denied';
  return 'default';
}

/** Shallow list of top-level keys whose serialised values differ.
 *  Good enough for a summary chip — the full diff lives in the
 *  expanded before / after JSON blocks. */
function diffKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k);
  }
  return out;
}
