import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type ReminderKind,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/zod/task';
import { TaskForm, type TaskFormInitial } from './_components/TaskForm';
import { TaskRowActions } from './_components/TaskRowActions';

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
  owner: { full_name: string } | null;
  assigned_by: { full_name: string } | null;
  reminders: { reminder_kind: ReminderKind; reminder_at: string; sent_at: string | null }[];
};

const PRIORITY_VARIANT: Record<TaskPriority, 'neutral' | 'blue' | 'amber' | 'red'> = {
  low: 'neutral',
  med: 'blue',
  high: 'amber',
  urgent: 'red',
};

export default async function CompanyTasksTab({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { edit?: string };
}) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-agsi-darkGray">
          Tasks are not available to leadership.
        </CardContent>
      </Card>
    );
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [tasksRes, profilesRes] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, title, description, due_date, priority, status, owner_id, assigned_by_id, source, owner:profiles!tasks_owner_id_fkey(full_name), assigned_by:profiles!tasks_assigned_by_id_fkey(full_name), reminders:task_reminders(reminder_kind, reminder_at, sent_at)',
      )
      .eq('company_id', params.id)
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .returns<TaskRow[]>(),
    // BD members only — leadership doesn't take task ownership.
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .in('role', ['admin', 'bd_head', 'bd_manager'])
      .order('full_name'),
  ]);

  const canAssignToOthers = user.role === 'admin' || user.role === 'bd_head';

  const tasks = tasksRes.data ?? [];
  const profiles = (profilesRes.data ?? []) as Array<{ id: string; full_name: string }>;

  // Build initial for edit mode
  let editInitial: TaskFormInitial | null = null;
  if (searchParams.edit) {
    const t = tasks.find((x) => x.id === searchParams.edit);
    if (t) {
      const customRem = t.reminders?.find((r) => r.reminder_kind === 'custom');
      editInitial = {
        id: t.id,
        title: t.title,
        description: t.description,
        owner_id: t.owner_id,
        due_date: t.due_date,
        priority: t.priority,
        status: t.status,
        reminder_kinds: (t.reminders ?? []).map((r) => r.reminder_kind),
        // datetime-local format: YYYY-MM-DDTHH:mm
        reminder_custom_at: customRem
          ? new Date(customRem.reminder_at).toISOString().slice(0, 16)
          : null,
      };
    }
  }

  return (
    <div className="space-y-4">
      {editInitial ? (
        <TaskForm
          mode="edit"
          companyId={params.id}
          profiles={profiles}
          defaultOwnerId={user.id}
          initial={editInitial}
          canAssignToOthers={canAssignToOthers}
        />
      ) : (
        <TaskForm
          mode="create"
          companyId={params.id}
          profiles={profiles}
          defaultOwnerId={user.id}
          canAssignToOthers={canAssignToOthers}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>{tasks.length} total. Sorted by status then due date.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No tasks yet. Click &quot;New task&quot; above.
            </p>
          ) : (
            <Table>
              <THead>
                <TR head>
                  <TH className="px-4">Task</TH>
                  <TH className="px-4">Owner</TH>
                  <TH className="px-4">Due</TH>
                  <TH className="px-4">Priority</TH>
                  <TH className="px-4">Reminders</TH>
                  <TH className="px-4">Status</TH>
                </TR>
              </THead>
              <TBody>
                {tasks.map((t) => {
                  const overdue =
                    t.due_date &&
                    t.status !== 'done' &&
                    t.status !== 'cancelled' &&
                    t.due_date < new Date().toISOString().slice(0, 10);
                  const canEdit =
                    user.role === 'admin' ||
                    user.role === 'bd_head' ||
                    (user.role === 'bd_manager' && t.owner_id === user.id);
                  const canDelete = canEdit;
                  const pendingReminders = (t.reminders ?? []).filter((r) => !r.sent_at).length;
                  const sentReminders = (t.reminders ?? []).filter((r) => r.sent_at).length;
                  return (
                    <TR
                      key={t.id}
                      className={
                        t.status === 'done' || t.status === 'cancelled' ? 'opacity-60' : ''
                      }
                    >
                      <TD className="px-4">
                        <div className="font-medium text-agsi-navy">{t.title}</div>
                        {t.description && (
                          <div className="mt-0.5 text-xs text-agsi-darkGray">{t.description}</div>
                        )}
                        {t.source !== 'manual' && (
                          <Badge variant="amber" className="mt-1">
                            {t.source}
                          </Badge>
                        )}
                      </TD>
                      <TD className="px-4 text-agsi-darkGray">
                        <div>{t.owner?.full_name ?? '—'}</div>
                        {t.assigned_by?.full_name && (
                          <div className="text-xs2 italic text-agsi-midGray">
                            assigned by {t.assigned_by.full_name}
                          </div>
                        )}
                      </TD>
                      <TD className="px-4">
                        <span className={overdue ? 'text-rag-red' : 'text-agsi-darkGray'}>
                          {t.due_date ?? '—'}
                          {overdue && ' · overdue'}
                        </span>
                      </TD>
                      <TD className="px-4">
                        <Badge variant={PRIORITY_VARIANT[t.priority]}>
                          {TASK_PRIORITY_LABEL[t.priority]}
                        </Badge>
                      </TD>
                      <TD className="px-4 text-xs text-agsi-darkGray tabular">
                        {pendingReminders + sentReminders === 0 ? (
                          '—'
                        ) : (
                          <>
                            <span title="Pending reminders">🔔 {pendingReminders}</span>
                            {sentReminders > 0 && (
                              <span className="ml-2 text-agsi-darkGray/60" title="Sent">
                                ✓ {sentReminders}
                              </span>
                            )}
                          </>
                        )}
                      </TD>
                      <TD className="px-4">
                        <div className="flex items-center gap-3">
                          <TaskRowActions
                            id={t.id}
                            status={t.status}
                            contextPath={`/companies/${params.id}/tasks`}
                            canDelete={canDelete}
                          />
                          {canEdit && (
                            <Link
                              href={`/companies/${params.id}/tasks?edit=${t.id}` as never}
                              className="text-xs text-agsi-accent hover:underline"
                            >
                              Edit
                            </Link>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {searchParams.edit && !editInitial && (
        <p className="text-xs text-rag-red">
          Couldn&apos;t find that task to edit (it may have been deleted).{' '}
          <Link href={`/companies/${params.id}/tasks` as never} className="hover:underline">
            Back to list
          </Link>
        </p>
      )}

      {TASK_STATUS_LABEL.open && null /* keep the import used in case of future inline status badge */}
    </div>
  );
}
