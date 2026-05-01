import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/zod/task';
import { GlobalTaskStatusSelect } from './_components/GlobalTaskRowActions';

export const dynamic = 'force-dynamic';

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  owner_id: string;
  source: string;
  company_id: string | null;
  project_id: string | null;
  owner: { full_name: string } | null;
  company: { id: string; canonical_name: string } | null;
  project: { id: string; name: string } | null;
};

const PRIORITY_VARIANT: Record<TaskPriority, 'neutral' | 'blue' | 'amber' | 'red'> = {
  low: 'neutral',
  med: 'blue',
  high: 'amber',
  urgent: 'red',
};

export default async function GlobalTasksPage({
  searchParams,
}: {
  searchParams: { scope?: string; status?: string };
}) {
  const user = await requireRole(['admin', 'bd_head', 'bd_manager']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const scope = searchParams.scope === 'team' ? 'team' : 'mine';
  const statusFilter =
    searchParams.status && (TASK_STATUSES as readonly string[]).includes(searchParams.status)
      ? (searchParams.status as TaskStatus)
      : null;

  let query = supabase
    .from('tasks')
    .select(
      'id, title, description, due_date, priority, status, owner_id, source, company_id, project_id, owner:profiles!tasks_owner_id_fkey(full_name), company:companies(id, canonical_name), project:projects(id, name)',
    )
    .order('status', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500);

  if (scope === 'mine') query = query.eq('owner_id', user.id);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data } = await query.returns<TaskRow[]>();
  const tasks = data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Tasks</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Manual + system-generated tasks across companies and projects.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-agsi-lightGray/40 p-1">
          {(['mine', 'team'] as const).map((s) => (
            <Link
              key={s}
              href={`/tasks?scope=${s}${statusFilter ? `&status=${statusFilter}` : ''}`}
              className={
                scope === s
                  ? 'rounded-md bg-white px-3 py-1 text-xs font-medium text-agsi-navy shadow-sm'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-agsi-darkGray hover:text-agsi-navy'
              }
            >
              {s === 'mine' ? 'My tasks' : 'Whole team'}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link
            href={`/tasks?scope=${scope}`}
            className={
              !statusFilter
                ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            All
          </Link>
          {TASK_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/tasks?scope=${scope}&status=${s}`}
              className={
                statusFilter === s
                  ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                  : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
              }
            >
              {TASK_STATUS_LABEL[s]}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tasks.length} tasks</CardTitle>
          <CardDescription>
            Create new tasks from a company&apos;s Tasks tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No tasks match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Linked to</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const overdue =
                    t.due_date &&
                    t.status !== 'done' &&
                    t.status !== 'cancelled' &&
                    t.due_date < today;
                  return (
                    <tr
                      key={t.id}
                      className={
                        t.status === 'done' || t.status === 'cancelled'
                          ? 'border-b border-agsi-lightGray/50 opacity-60'
                          : 'border-b border-agsi-lightGray/50'
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-agsi-navy">{t.title}</div>
                        {t.description && (
                          <div className="mt-0.5 text-xs text-agsi-darkGray">{t.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {t.company && (
                          <Link
                            href={`/companies/${t.company.id}`}
                            className="text-agsi-navy hover:underline"
                          >
                            {t.company.canonical_name}
                          </Link>
                        )}
                        {t.project && (
                          <Link
                            href={`/projects/${t.project.id}`}
                            className="ml-2 text-xs text-agsi-accent hover:underline"
                          >
                            ↳ {t.project.name}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">{t.owner?.full_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={overdue ? 'text-rag-red' : 'text-agsi-darkGray'}>
                          {t.due_date ?? '—'}
                          {overdue && ' · overdue'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={PRIORITY_VARIANT[t.priority]}>
                          {TASK_PRIORITY_LABEL[t.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <GlobalTaskStatusSelect id={t.id} status={t.status} />
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

      {tasks.length === 0 && scope === 'mine' && (
        <p className="text-xs text-agsi-darkGray">
          Try{' '}
          <Link href="/tasks?scope=team" className="text-agsi-accent hover:underline">
            switching to &quot;Whole team&quot;
          </Link>{' '}
          to see everyone&apos;s tasks.
        </p>
      )}

      {tasks.length === 0 && scope === 'team' && (
        <Link href="/companies">
          <Button variant="secondary">Open a company to create one →</Button>
        </Link>
      )}
    </div>
  );
}
