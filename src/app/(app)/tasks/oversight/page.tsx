import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireFeature } from '@/lib/auth/features';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskStatus,
} from '@/lib/zod/task';

export const dynamic = 'force-dynamic';

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: TaskStatus;
  owner_id: string;
  assigned_by_id: string | null;
  company_id: string | null;
  owner: { full_name: string } | null;
  assigned_by: { full_name: string } | null;
  company: { id: string; canonical_name: string } | null;
};

type Member = { id: string; full_name: string };

export default async function TaskOversightPage({
  searchParams,
}: {
  searchParams: { member?: string; status?: string; overdue?: string };
}) {
  // Route-level gate: admin + bd_head only. bd_manager and leadership
  // 404 even if they craft the URL. Note: tasks SELECT RLS (0022) is
  // still permissive for the ops trio — a tightening pass (forbid
  // bd_manager from SELECT'ing rows they don't own) belongs in a
  // separate item because it would also affect /tasks?scope=team and
  // company Tasks tabs.
  const user = await requireFeature('tasks');
  if (user.role !== 'admin' && user.role !== 'bd_head') notFound();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [tasksRes, membersRes] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, title, due_date, status, owner_id, assigned_by_id, company_id, owner:profiles!tasks_owner_id_fkey(full_name), assigned_by:profiles!tasks_assigned_by_id_fkey(full_name), company:companies(id, canonical_name)',
      )
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(2000)
      .returns<TaskRow[]>(),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .in('role', ['admin', 'bd_head', 'bd_manager'])
      .order('full_name')
      .returns<Member[]>(),
  ]);

  const tasks = tasksRes.data ?? [];
  const members = membersRes.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // Per-member counts are computed from the UNFILTERED task set so the
  // overview stays a stable load picture regardless of filter state.
  // Cancelled is excluded from every bucket — it's still a valid
  // status, just not work-in-flight.
  type Counts = { open: number; overdue: number; completed: number };
  const counts = new Map<string, Counts>();
  for (const m of members) counts.set(m.id, { open: 0, overdue: 0, completed: 0 });
  for (const t of tasks) {
    const c = counts.get(t.owner_id);
    if (!c) continue;
    if (t.status === 'open' || t.status === 'in_progress') {
      c.open += 1;
      if (t.due_date && t.due_date < today) c.overdue += 1;
    } else if (t.status === 'done') {
      c.completed += 1;
    }
  }

  // Filters from URL searchParams.
  const memberFilter = searchParams.member ?? '';
  const statusFilter =
    searchParams.status && (TASK_STATUSES as readonly string[]).includes(searchParams.status)
      ? (searchParams.status as TaskStatus)
      : null;
  const overdueOnly = searchParams.overdue === '1';

  const visibleTasks = tasks.filter((t) => {
    if (memberFilter && t.owner_id !== memberFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (overdueOnly) {
      if (t.status === 'done' || t.status === 'cancelled') return false;
      if (!t.due_date || t.due_date >= today) return false;
    }
    return true;
  });

  // Build query-preserving links for the filter row.
  function withFilter(patch: Partial<{ member: string; status: string; overdue: string }>) {
    const params = new URLSearchParams();
    const merged = {
      member: memberFilter,
      status: statusFilter ?? '',
      overdue: overdueOnly ? '1' : '',
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, String(v));
    }
    const qs = params.toString();
    return `/tasks/oversight${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Team task oversight</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Where every member stands today — open / overdue / completed. This
            is a load and help view, not a leaderboard: members are listed
            alphabetically and are not ranked by completion.
          </p>
        </div>
        <Link
          href="/tasks"
          className="rounded border border-agsi-midGray bg-white px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40"
        >
          ← My tasks
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-member summary</CardTitle>
          <CardDescription>
            Counts cover all tasks (company-linked and ad-hoc). Cancelled tasks
            are excluded. Overdue counts the open tasks whose due date has
            passed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-agsi-darkGray">No active BD members found.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => {
                const c = counts.get(m.id) ?? { open: 0, overdue: 0, completed: 0 };
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-agsi-lightGray bg-white p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} size="md" />
                      <div>
                        <p className="text-sm font-medium text-agsi-navy">{m.full_name}</p>
                        <p className="text-xs text-agsi-darkGray">
                          Open <span className="tabular-nums text-agsi-navy">{c.open}</span>
                          {c.overdue > 0 && (
                            <>
                              {' '}· Overdue{' '}
                              <span className="font-semibold tabular-nums text-rag-red">
                                {c.overdue}
                              </span>
                            </>
                          )}
                          {' '}· Done{' '}
                          <span className="tabular-nums text-agsi-navy">{c.completed}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-agsi-lightGray bg-white p-3 text-xs">
        <span className="font-medium uppercase tracking-wide text-agsi-darkGray">
          Filter
        </span>
        <Link
          href={withFilter({ member: '' }) as never}
          className={
            !memberFilter
              ? 'rounded border border-agsi-navy bg-agsi-navy px-2 py-1 font-medium text-white'
              : 'rounded border border-agsi-midGray px-2 py-1 font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          All members
        </Link>
        {members.map((m) => (
          <Link
            key={m.id}
            href={withFilter({ member: m.id }) as never}
            className={
              memberFilter === m.id
                ? 'rounded border border-agsi-navy bg-agsi-navy px-2 py-1 font-medium text-white'
                : 'rounded border border-agsi-midGray px-2 py-1 font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {m.full_name}
          </Link>
        ))}
        <span className="ml-2 mr-1 h-4 w-px bg-agsi-lightGray" aria-hidden />
        <Link
          href={withFilter({ status: '' }) as never}
          className={
            !statusFilter
              ? 'rounded border border-agsi-navy bg-agsi-navy px-2 py-1 font-medium text-white'
              : 'rounded border border-agsi-midGray px-2 py-1 font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          All statuses
        </Link>
        {TASK_STATUSES.map((s) => (
          <Link
            key={s}
            href={withFilter({ status: s }) as never}
            className={
              statusFilter === s
                ? 'rounded border border-agsi-navy bg-agsi-navy px-2 py-1 font-medium text-white'
                : 'rounded border border-agsi-midGray px-2 py-1 font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {TASK_STATUS_LABEL[s]}
          </Link>
        ))}
        <span className="ml-2 mr-1 h-4 w-px bg-agsi-lightGray" aria-hidden />
        <Link
          href={withFilter({ overdue: overdueOnly ? '' : '1' }) as never}
          className={
            overdueOnly
              ? 'rounded border border-rag-red bg-rag-red px-2 py-1 font-medium text-white'
              : 'rounded border border-agsi-midGray px-2 py-1 font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          {overdueOnly ? '✓ Overdue only' : 'Overdue only'}
        </Link>
        <span className="ml-auto text-[11px] text-agsi-darkGray">
          {visibleTasks.length} of {tasks.length}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All tasks</CardTitle>
          <CardDescription>
            Company-linked and ad-hoc. Click a company-linked task to open its
            edit form on the company Tasks tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {visibleTasks.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No tasks match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                    <th className="px-4 py-2 font-medium">Task</th>
                    <th className="px-4 py-2 font-medium">Assignee</th>
                    <th className="px-4 py-2 font-medium">Linked to</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Assigned by</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((t) => {
                    const isOverdue =
                      t.status !== 'done' &&
                      t.status !== 'cancelled' &&
                      t.due_date !== null &&
                      t.due_date < today;
                    const editHref = t.company_id
                      ? `/companies/${t.company_id}/tasks?edit=${t.id}`
                      : null;
                    return (
                      <tr
                        key={t.id}
                        className={cn(
                          'border-b border-agsi-lightGray/50',
                          (t.status === 'done' || t.status === 'cancelled') &&
                            'opacity-60',
                        )}
                      >
                        <td className="px-4 py-3">
                          {editHref ? (
                            <Link
                              href={editHref as never}
                              className="font-medium text-agsi-navy hover:underline"
                            >
                              {t.title}
                            </Link>
                          ) : (
                            <span className="font-medium text-agsi-navy">{t.title}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-agsi-darkGray">
                          <div className="flex items-center gap-2">
                            <Avatar name={t.owner?.full_name ?? null} size="xs" />
                            {t.owner?.full_name ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-agsi-darkGray">
                          {t.company ? (
                            <Link
                              href={`/companies/${t.company.id}`}
                              className="text-agsi-navy hover:underline"
                            >
                              {t.company.canonical_name}
                            </Link>
                          ) : (
                            <Badge variant="neutral">Ad-hoc</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              isOverdue
                                ? 'font-semibold text-rag-red'
                                : 'text-agsi-darkGray'
                            }
                          >
                            {t.due_date ?? '—'}
                            {isOverdue && ' · overdue'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-agsi-darkGray">
                          {TASK_STATUS_LABEL[t.status]}
                        </td>
                        <td className="px-4 py-3 text-xs text-agsi-darkGray">
                          {t.assigned_by?.full_name ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
