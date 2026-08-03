'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { SPOKE_TYPES } from '@/types/coverage';
import {
  COOLING_DAYS,
  HIGH_VALUE_THRESHOLD_AED,
  TYPE_WEIGHT,
  daysBetween,
  formatAed,
  type ActionItem,
  type ActionQueue,
  type CompanyStub,
} from '@/lib/action-queue';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

const ECOSYSTEM_SUBTYPES = [
  'call',
  'meeting',
  'email',
  'site_visit',
  'workshop',
  'document_sent',
  'L0_to_L1',
  'L1_to_L2',
  'L2_to_L3',
  'L3_to_L4',
  'L4_to_L5',
] as const;

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

type CompanyRow = {
  id: string;
  canonical_name: string;
  company_type: string;
  current_level: string;
};

/**
 * Value-scaled tiebreak in [0, 99] for cold rows. Log-scale so a 10×
 * value gap doesn't linearly dominate — the bucket bumps are visible
 * but never leak into another type's tier (weights are 100+ apart).
 */
function coldValueBonus(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // log10(1) = 0, log10(1e10) = 10 → scale into [0..99].
  const scaled = Math.min(99, Math.floor((Math.log10(value + 1) / 10) * 99));
  return Math.max(0, scaled);
}

/** Age-in-days tiebreak, clamped to [0, 99]. */
function ageBonus(days: number): number {
  return Math.max(0, Math.min(99, days));
}

/**
 * Per-user daily action queue. Read-only aggregation over sources
 * that already exist — notifications (mentions), tasks (overdue),
 * companies + ecosystem_events (cold), level_change_requests
 * (approvals). Nothing is written and no schema changes.
 *
 * Scope is strictly the current user:
 *   - mentions: recipient_id = auth.uid() (via RLS)
 *   - overdue_task: owner_id = user.id
 *   - cold_high_value: companies.owner_id = user.id
 *   - pending_approval: only if user.role === 'admin' (the RPC guard
 *     matches — approve_level_change_request rejects everyone else)
 */
export async function getActionQueue(): Promise<ActionQueue> {
  const user = await getCurrentUser();
  const sb = supabase();
  const now = new Date();
  const today = TODAY_ISO();

  const items: ActionItem[] = [];
  const viewerIsApprover = user.role === 'admin';

  // Leadership has no "queue" — they're view-only observers. Return
  // an empty queue rather than surfacing team-wide items.
  if (user.role === 'leadership') {
    return { items, viewerIsApprover: false };
  }

  // ── Mentions ─────────────────────────────────────────────────
  type MentionRow = {
    id: string;
    subject: string;
    body: string;
    link_url: string | null;
    related_company_id: string | null;
    entity_id: string | null;
    created_at: string;
    related_company: CompanyRow | null;
  };
  const { data: mentions } = await sb
    .from('notifications')
    .select(
      'id, subject, body, link_url, related_company_id, entity_id, created_at, ' +
        'related_company:companies!notifications_related_company_id_fkey(id, canonical_name, company_type, current_level)',
    )
    .eq('notification_type', 'mention')
    .eq('is_read', false)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .returns<MentionRow[]>();

  for (const m of mentions ?? []) {
    if (!m.related_company) continue; // orphaned company (merged / removed)
    const ageDays = daysBetween(m.created_at, now);
    const company = companyStub(m.related_company);
    items.push({
      key: `mention:${m.id}`,
      type: 'mention',
      priority: TYPE_WEIGHT.mention + ageBonus(99 - ageDays), // newer bumps higher
      reason: m.subject || `Mention on ${company.canonical_name}`,
      link_url:
        m.link_url ??
        `/companies/${company.id}?comment=${m.entity_id ?? ''}`,
      context: contextLine(company),
      occurred_at: m.created_at,
      company,
    });
  }

  // ── Overdue tasks ────────────────────────────────────────────
  type TaskRow = {
    id: string;
    title: string;
    due_date: string | null;
    status: 'open' | 'in_progress';
    company_id: string | null;
    company: CompanyRow | null;
  };
  const { data: overdue } = await sb
    .from('tasks')
    .select(
      'id, title, due_date, status, company_id, company:companies!tasks_company_id_fkey(id, canonical_name, company_type, current_level)',
    )
    .eq('owner_id', user.id)
    .in('status', ['open', 'in_progress'])
    .not('due_date', 'is', null)
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .limit(200)
    .returns<TaskRow[]>();

  for (const t of overdue ?? []) {
    if (!t.company || !t.due_date) continue;
    const daysOverdue = daysBetween(t.due_date, now);
    const company = companyStub(t.company);
    items.push({
      key: `task:${t.id}`,
      type: 'overdue_task',
      priority: TYPE_WEIGHT.overdue_task + ageBonus(daysOverdue),
      reason: t.title,
      link_url: `/companies/${company.id}/tasks`,
      context: `${contextLine(company)} · overdue ${daysOverdue}d`,
      occurred_at: t.due_date,
      company,
    });
  }

  // ── Cold owned stakeholders (value-ranked) ───────────────────
  // Only include SPOKE_TYPES — matches every other coverage/value
  // surface. Fetch owned companies first; then fold in per-company
  // last_at from ecosystem_events + associated project value.
  type OwnedCompanyRow = CompanyRow & { owner_id: string };
  const { data: owned } = await sb
    .from('companies')
    .select('id, canonical_name, company_type, current_level, owner_id')
    .eq('owner_id', user.id)
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .in('company_type', SPOKE_TYPES as unknown as string[])
    .returns<OwnedCompanyRow[]>();

  const ownedIds = (owned ?? []).map((c) => c.id);

  // Per-company last qualifying event. Fetch in one shot then reduce
  // client-side — small dataset (bd_manager typically owns tens of
  // companies, not thousands).
  type EventRow = { company_id: string; occurred_at: string };
  const lastEventByCompany = new Map<string, string>();
  if (ownedIds.length > 0) {
    const { data: events } = await sb
      .from('ecosystem_events')
      .select('company_id, occurred_at')
      .in('company_id', ownedIds)
      .eq('is_void', false)
      .in('event_subtype', ECOSYSTEM_SUBTYPES as unknown as string[])
      .order('occurred_at', { ascending: false })
      .limit(5000)
      .returns<EventRow[]>();
    for (const e of events ?? []) {
      if (!lastEventByCompany.has(e.company_id)) {
        lastEventByCompany.set(e.company_id, e.occurred_at);
      }
    }
  }

  // Per-company associated project value — SUM(DISTINCT projects.value_aed)
  // over the project_companies link. Nulls treated as 0 so a partially
  // valued portfolio still ranks.
  type PcRow = {
    company_id: string;
    projects: { id: string; value_aed: string | number | null } | null;
  };
  const valueByCompany = new Map<string, number>();
  const seenProjectPerCompany = new Map<string, Set<string>>();
  if (ownedIds.length > 0) {
    const { data: pcs } = await sb
      .from('project_companies')
      .select('company_id, projects!inner(id, value_aed)')
      .in('company_id', ownedIds)
      .eq('is_current', true)
      .returns<PcRow[]>();
    for (const r of pcs ?? []) {
      if (!r.projects) continue;
      const seen =
        seenProjectPerCompany.get(r.company_id) ?? new Set<string>();
      if (seen.has(r.projects.id)) continue;
      seen.add(r.projects.id);
      seenProjectPerCompany.set(r.company_id, seen);
      const v = Number(r.projects.value_aed ?? 0);
      if (!Number.isFinite(v)) continue;
      valueByCompany.set(
        r.company_id,
        (valueByCompany.get(r.company_id) ?? 0) + v,
      );
    }
  }

  for (const c of owned ?? []) {
    const last = lastEventByCompany.get(c.id) ?? null;
    const days = last ? daysBetween(last, now) : Number.POSITIVE_INFINITY;
    // Cooling OR cold (>=90d or never touched).
    if (days < COOLING_DAYS) continue;
    const value = valueByCompany.get(c.id) ?? 0;
    const company = companyStub(c);
    const band = days === Number.POSITIVE_INFINITY || days >= 180 ? 'cold' : 'cooling';
    const ageLabel = last
      ? `${band} · last touch ${Math.round(days)}d ago`
      : `${band} · no recorded touch`;
    items.push({
      key: `cold:${c.id}`,
      type: 'cold_high_value',
      priority: TYPE_WEIGHT.cold_high_value + coldValueBonus(value),
      reason: `${company.canonical_name} has gone quiet`,
      link_url: `/companies/${company.id}`,
      context: `${contextLine(company)} · ${ageLabel}${value > 0 ? ` · ${formatAed(value)} at risk` : ''}`,
      occurred_at: last ?? new Date(0).toISOString(),
      value_aed: value,
      company,
    });
  }

  // ── Pending approvals — admin only ───────────────────────────
  if (viewerIsApprover) {
    type ApprovalRow = {
      id: string;
      company_id: string;
      from_level: string;
      to_level: string;
      created_at: string;
      company: CompanyRow | null;
    };
    const { data: approvals } = await sb
      .from('level_change_requests')
      .select(
        'id, company_id, from_level, to_level, created_at, ' +
          'company:companies!level_change_requests_company_id_fkey(id, canonical_name, company_type, current_level)',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(200)
      .returns<ApprovalRow[]>();

    for (const a of approvals ?? []) {
      if (!a.company) continue;
      const ageDays = daysBetween(a.created_at, now);
      const company = companyStub(a.company);
      items.push({
        key: `approval:${a.id}`,
        type: 'pending_approval',
        priority: TYPE_WEIGHT.pending_approval + ageBonus(ageDays),
        reason: `Approve ${a.from_level} → ${a.to_level} for ${company.canonical_name}`,
        link_url: `/admin/level-requests`,
        context: `${contextLine(company)} · pending ${ageDays}d`,
        occurred_at: a.created_at,
        company,
      });
    }
  }

  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Deterministic tiebreak so ties don't shuffle across renders.
    return a.key.localeCompare(b.key);
  });

  return { items, viewerIsApprover };
}

function companyStub(row: CompanyRow): CompanyStub {
  return {
    id: row.id,
    canonical_name: row.canonical_name,
    company_type: row.company_type,
    current_level: row.current_level,
  };
}

function contextLine(company: CompanyStub): string {
  const type =
    (COMPANY_TYPE_LABEL as Record<string, string>)[company.company_type] ??
    company.company_type;
  return `${company.current_level} · ${type}`;
}
