'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import type { TaskPriority, TaskStatus } from '@/lib/zod/task';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type MyTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  updated_at: string;
  company_id: string | null;
  company_name: string | null;
  assigned_by_lead: boolean;
  assigner_name: string | null;
  /** true when in_progress + no update in ≥ 7 days. */
  stalled: boolean;
};

export type MyTasksData = {
  rows: MyTaskRow[];
  /** Momentum: done_last_7d / (done_last_7d + open_now) — a quiet ratio,
   *  never rendered as a percentage-badge, only as a `N of M done this
   *  week` line above a thin progress bar. */
  doneLast7d: number;
  openNow: number;
};

const STALLED_DAYS = 7;

function isStalled(status: TaskStatus, updated_at: string, now: Date): boolean {
  if (status !== 'in_progress') return false;
  const ageDays =
    (now.getTime() - new Date(updated_at).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= STALLED_DAYS;
}

/**
 * The caller's own open + in-progress tasks (both self-set and
 * lead-assigned — both cases have owner_id = self). Includes the
 * assigner's display name for the "from {lead}" tag when the task
 * was lead-assigned. Never returns rows the caller doesn't own —
 * both the query filter AND the tightened tasks_select_ops RLS
 * (0106) enforce this.
 *
 * Momentum figures are computed alongside so the panel can render a
 * "N of M done this week" line without a second round trip.
 */
export async function getMyTasks(): Promise<MyTasksData> {
  const user = await getCurrentUser();
  const sb = supabase();
  const now = new Date();
  const weekAgoIso = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  type Raw = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string | null;
    updated_at: string;
    company_id: string | null;
    assigned_by_id: string | null;
    owner_id: string;
    company: { canonical_name: string } | { canonical_name: string }[] | null;
    assigner:
      | { full_name: string; role: string }
      | { full_name: string; role: string }[]
      | null;
  };

  const openRes = await sb
    .from('tasks')
    .select(
      'id, title, status, priority, due_date, updated_at, company_id, assigned_by_id, owner_id, ' +
        'company:companies!tasks_company_id_fkey(canonical_name), ' +
        'assigner:profiles!tasks_assigned_by_id_fkey(full_name, role)',
    )
    .eq('owner_id', user.id)
    .in('status', ['open', 'in_progress'])
    .order('due_date', { ascending: true, nullsFirst: false })
    .returns<Raw[]>();

  const doneRes = await sb
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .eq('status', 'done')
    .gte('completed_at', weekAgoIso);

  const rows: MyTaskRow[] = (openRes.data ?? []).map((r) => {
    const company = Array.isArray(r.company) ? r.company[0] : r.company;
    const assigner = Array.isArray(r.assigner) ? r.assigner[0] : r.assigner;
    // "Assigned by a lead" only counts when the assigner is admin /
    // bd_head AND differs from the owner. The 0051 insert path
    // already stamps assigned_by_id only on cross-member assignment,
    // but the role check makes the semantic explicit for the UI.
    const assigned_by_lead =
      !!r.assigned_by_id &&
      r.assigned_by_id !== r.owner_id &&
      !!assigner &&
      (assigner.role === 'admin' || assigner.role === 'bd_head');
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date,
      updated_at: r.updated_at,
      company_id: r.company_id,
      company_name: company?.canonical_name ?? null,
      assigned_by_lead,
      assigner_name: assigned_by_lead ? (assigner?.full_name ?? null) : null,
      stalled: isStalled(r.status, r.updated_at, now),
    };
  });

  return {
    rows,
    doneLast7d: doneRes.count ?? 0,
    openNow: rows.length,
  };
}

export type AssignedByMeRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  updated_at: string;
  company_id: string | null;
  company_name: string | null;
  assignee_id: string;
  assignee_name: string | null;
  stalled: boolean;
};

/**
 * Lead view: open + in-progress tasks the caller assigned to
 * someone else. Admin/bd_head only. bd_manager hitting this action
 * gets an empty list rather than an error — the panel that calls
 * it is role-gated in the dashboard.
 */
export async function getAssignedByMe(): Promise<AssignedByMeRow[]> {
  const user = await getCurrentUser();
  if (user.role !== 'admin' && user.role !== 'bd_head') return [];
  const sb = supabase();
  const now = new Date();

  type Raw = {
    id: string;
    title: string;
    status: TaskStatus;
    due_date: string | null;
    updated_at: string;
    company_id: string | null;
    owner_id: string;
    company: { canonical_name: string } | { canonical_name: string }[] | null;
    owner: { full_name: string } | { full_name: string }[] | null;
  };

  const { data } = await sb
    .from('tasks')
    .select(
      'id, title, status, due_date, updated_at, company_id, owner_id, ' +
        'company:companies!tasks_company_id_fkey(canonical_name), ' +
        'owner:profiles!tasks_owner_id_fkey(full_name)',
    )
    .eq('assigned_by_id', user.id)
    .neq('owner_id', user.id)
    .in('status', ['open', 'in_progress'])
    .order('due_date', { ascending: true, nullsFirst: false })
    .returns<Raw[]>();

  return (data ?? []).map((r) => {
    const company = Array.isArray(r.company) ? r.company[0] : r.company;
    const owner = Array.isArray(r.owner) ? r.owner[0] : r.owner;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_date: r.due_date,
      updated_at: r.updated_at,
      company_id: r.company_id,
      company_name: company?.canonical_name ?? null,
      assignee_id: r.owner_id,
      assignee_name: owner?.full_name ?? null,
      stalled: isStalled(r.status, r.updated_at, now),
    };
  });
}
