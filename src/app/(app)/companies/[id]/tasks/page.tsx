import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type ReminderKind,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/zod/task';
import {
  TaskForm,
  type CommentContext,
  type EngagementContext,
  type TaskFormInitial,
} from './_components/TaskForm';
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
  engagement_id: string | null;
  engagement: {
    id: string;
    summary: string;
    engagement_date: string;
  } | {
    id: string;
    summary: string;
    engagement_date: string;
  }[] | null;
  owner: { full_name: string } | null;
  assigned_by: { full_name: string } | null;
  reminders: { reminder_kind: ReminderKind; reminder_at: string; sent_at: string | null }[];
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

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
  searchParams: {
    edit?: string;
    from_engagement?: string;
    from_comment?: string;
  };
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

  const [tasksRes, profilesRes, companyRes] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, title, description, due_date, priority, status, owner_id, assigned_by_id, source, engagement_id, engagement:engagements(id, summary, engagement_date), owner:profiles!tasks_owner_id_fkey(full_name), assigned_by:profiles!tasks_assigned_by_id_fkey(full_name), reminders:task_reminders(reminder_kind, reminder_at, sent_at)',
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
    supabase
      .from('companies')
      .select('canonical_name')
      .eq('id', params.id)
      .maybeSingle<{ canonical_name: string }>(),
  ]);

  // Follow-up entry path: TaskForm opens pre-filled with engagement
  // context + a "Follow up: {company}" default title. Same pattern
  // for from_comment (added in this build) — either seeds the same
  // title default; the two contexts are mutually exclusive in the
  // URL but the form gracefully renders both blocks if handed both.
  let engagementContext: EngagementContext | null = null;
  let commentContext: CommentContext | null = null;
  let commentDescriptionDefault: string | null = null;
  let followUpTitleDefault: string | null = null;
  if (searchParams.from_engagement) {
    const { data: eng } = await supabase
      .from('engagements')
      .select(
        'id, summary, engagement_date, author:profiles!engagements_created_by_fkey(full_name)',
      )
      .eq('id', searchParams.from_engagement)
      .eq('company_id', params.id)
      .maybeSingle<{
        id: string;
        summary: string;
        engagement_date: string;
        author:
          | { full_name: string }
          | { full_name: string }[]
          | null;
      }>();
    if (eng) {
      const author = pickOne(eng.author);
      engagementContext = {
        id: eng.id,
        summary: eng.summary,
        engagement_date: eng.engagement_date,
        author_name: author?.full_name ?? null,
        href: `/companies/${params.id}/engagements`,
      };
      const companyName = companyRes.data?.canonical_name ?? 'this stakeholder';
      followUpTitleDefault = `Follow up: ${companyName}`;
    }
  }

  if (searchParams.from_comment) {
    const { data: cmt } = await supabase
      .from('company_comments')
      .select(
        'id, body, created_at, deleted_at, author:profiles!company_comments_author_id_fkey(full_name)',
      )
      .eq('id', searchParams.from_comment)
      .eq('company_id', params.id)
      .maybeSingle<{
        id: string;
        body: string;
        created_at: string;
        deleted_at: string | null;
        author:
          | { full_name: string }
          | { full_name: string }[]
          | null;
      }>();
    if (cmt && !cmt.deleted_at) {
      const author = pickOne(cmt.author);
      commentContext = {
        id: cmt.id,
        body: cmt.body,
        created_at: cmt.created_at,
        author_name: author?.full_name ?? null,
        href: `/companies/${params.id}?comment=${cmt.id}`,
      };
      const companyName = companyRes.data?.canonical_name ?? 'this stakeholder';
      followUpTitleDefault = followUpTitleDefault ?? `Follow up: ${companyName}`;
      const preview = (cmt.body ?? '').trim().slice(0, 500);
      commentDescriptionDefault = preview ? `From comment: "${preview}"` : null;
    }
  }

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
          engagementContext={engagementContext ?? undefined}
          commentContext={commentContext ?? undefined}
          titleDefault={followUpTitleDefault ?? undefined}
          descriptionDefault={commentDescriptionDefault ?? undefined}
          defaultOpen={engagementContext !== null || commentContext !== null}
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
            <ul className="divide-y divide-agsi-lightGray/70">
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
                const eng = pickOne(t.engagement);
                const engSummary =
                  eng && eng.summary.length > 80
                    ? eng.summary.slice(0, 80) + '…'
                    : eng?.summary;
                const dim =
                  t.status === 'done' || t.status === 'cancelled'
                    ? 'opacity-60'
                    : '';
                return (
                  <li key={t.id} className={`px-4 py-3 ${dim}`}>
                    {/* Line 1 — title uses the full width. line-clamp-2
                        keeps very long titles scannable; native `title`
                        gives full text on hover. Description +
                        engagement chip live below the title as
                        context, before the metadata row. */}
                    <p
                      className="line-clamp-2 text-sm font-medium text-agsi-navy"
                      title={t.title}
                    >
                      {t.title}
                    </p>
                    {t.description && (
                      <p
                        className="mt-0.5 line-clamp-2 text-xs text-agsi-darkGray"
                        title={t.description}
                      >
                        {t.description}
                      </p>
                    )}
                    {eng && (
                      <Link
                        href={`/companies/${params.id}/engagements`}
                        className="mt-1 inline-block text-xxs text-agsi-accent hover:underline"
                      >
                        From engagement: &ldquo;{engSummary}&rdquo; · {eng.engagement_date}
                      </Link>
                    )}

                    {/* Line 2 — compact metadata row. flex-wrap so it
                        collapses gracefully on narrow viewports rather
                        than sitting as fixed columns with dead
                        whitespace. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xxs text-agsi-darkGray">
                      <span
                        className="inline-flex items-center gap-1"
                        title={
                          t.assigned_by?.full_name
                            ? `Assigned by ${t.assigned_by.full_name}`
                            : undefined
                        }
                      >
                        <span className="text-agsi-midGray">Owner:</span>
                        <span className="text-agsi-navy">
                          {t.owner?.full_name ?? '—'}
                        </span>
                        {t.assigned_by?.full_name && (
                          <span className="italic text-agsi-midGray">
                            · assigned by {t.assigned_by.full_name}
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          overdue ? 'font-medium text-rag-red' : 'text-agsi-darkGray'
                        }
                      >
                        {t.due_date ? `Due ${t.due_date}` : 'No due date'}
                        {overdue && ' · overdue'}
                      </span>
                      <Badge variant={PRIORITY_VARIANT[t.priority]}>
                        {TASK_PRIORITY_LABEL[t.priority]}
                      </Badge>
                      {pendingReminders + sentReminders > 0 && (
                        <span
                          className="inline-flex items-center gap-1 tabular-nums"
                          title={`Reminders — ${pendingReminders} pending${
                            sentReminders > 0 ? `, ${sentReminders} sent` : ''
                          }`}
                        >
                          🔔 {pendingReminders}
                          {sentReminders > 0 && (
                            <span className="text-agsi-darkGray/60">
                              · ✓ {sentReminders}
                            </span>
                          )}
                        </span>
                      )}
                      {t.source !== 'manual' && (
                        <Badge variant="amber">{t.source}</Badge>
                      )}
                      <div className="ml-auto flex items-center gap-3">
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
                    </div>
                  </li>
                );
              })}
            </ul>
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
