import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireFeature } from '@/lib/auth/features';
import { Button } from '@/components/ui/button';
import { type TaskPriority, type TaskStatus } from '@/lib/zod/task';
import { TaskForm } from '../companies/[id]/tasks/_components/TaskForm';
import { TaskKanban } from './_components/TaskKanban';

export const dynamic = 'force-dynamic';

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  owner_id: string;
  assigned_by_id: string | null;
  source: string;
  company_id: string | null;
  project_id: string | null;
  owner: { full_name: string } | null;
  assigned_by: { full_name: string } | null;
  company: { id: string; canonical_name: string } | null;
  project: { id: string; name: string } | null;
  reminders: { reminder_kind: string }[];
};

export default async function GlobalTasksPage({
  searchParams,
}: {
  searchParams: { scope?: string };
}) {
  const user = await requireFeature('tasks');

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const scope = searchParams.scope === 'team' ? 'team' : 'mine';

  let query = supabase
    .from('tasks')
    .select(
      'id, title, description, due_date, priority, status, owner_id, assigned_by_id, source, company_id, project_id, owner:profiles!tasks_owner_id_fkey(full_name), assigned_by:profiles!tasks_assigned_by_id_fkey(full_name), company:companies(id, canonical_name), project:projects(id, name), reminders:task_reminders(reminder_kind)',
    )
    .order('status', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500);

  if (scope === 'mine') query = query.eq('owner_id', user.id);

  const { data } = await query.returns<TaskRow[]>();
  const tasks = data ?? [];

  // For the standalone-task form: BD members for the assign-to
  // selector. Same filter as the per-company tasks page.
  const { data: profilesRaw } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .in('role', ['admin', 'bd_head', 'bd_manager'])
    .order('full_name');
  const profiles = (profilesRaw ?? []) as Array<{ id: string; full_name: string }>;
  const canAssignToOthers = user.role === 'admin' || user.role === 'bd_head';
  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Tasks</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Manual + system-generated tasks across companies and projects, plus
          ad-hoc work not tied to any stakeholder.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-agsi-lightGray/40 p-1">
          {(['mine', 'team'] as const).map((s) => (
            <Link
              key={s}
              href={`/tasks?scope=${s}`}
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
      </div>

      {canCreate && (
        <TaskForm
          mode="create"
          companyId={null}
          profiles={profiles}
          defaultOwnerId={user.id}
          canAssignToOthers={canAssignToOthers}
        />
      )}

      <TaskKanban
        currentUserId={user.id}
        cards={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          due_date: t.due_date,
          company_id: t.company?.id ?? null,
          company_name: t.company?.canonical_name ?? null,
          owner_id: t.owner_id,
          owner_full_name: t.owner?.full_name ?? null,
          assigned_by_id: t.assigned_by_id,
          assigned_by_name: t.assigned_by?.full_name ?? null,
          has_reminders: (t.reminders ?? []).length > 0,
        }))}
      />

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
