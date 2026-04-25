import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/zod/task';
import { TaskForm } from './_components/TaskForm';
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
  source: string;
  owner: { full_name: string } | null;
};

const PRIORITY_VARIANT: Record<TaskPriority, 'neutral' | 'blue' | 'amber' | 'red'> = {
  low: 'neutral',
  med: 'blue',
  high: 'amber',
  urgent: 'red',
};

export default async function CompanyTasksTab({ params }: { params: { id: string } }) {
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
        'id, title, description, due_date, priority, status, owner_id, source, owner:profiles!tasks_owner_id_fkey(full_name)',
      )
      .eq('company_id', params.id)
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .returns<TaskRow[]>(),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name'),
  ]);

  const tasks = tasksRes.data ?? [];
  const profiles =
    (profilesRes.data ?? []) as Array<{ id: string; full_name: string }>;

  return (
    <div className="space-y-4">
      <TaskForm companyId={params.id} profiles={profiles} defaultOwnerId={user.id} />

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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const overdue =
                    t.due_date && t.status !== 'done' && t.status !== 'cancelled' && t.due_date < new Date().toISOString().slice(0, 10);
                  const canDelete =
                    user.role === 'admin' ||
                    (user.role !== 'leadership' && t.owner_id === user.id);
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
                        {t.source !== 'manual' && (
                          <Badge variant="amber" className="mt-1">
                            {t.source}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">{t.owner?.full_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            overdue ? 'text-rag-red' : 'text-agsi-darkGray'
                          }
                        >
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
                        <TaskRowActions
                          id={t.id}
                          status={t.status}
                          contextPath={`/companies/${params.id}/tasks`}
                          canDelete={canDelete}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
