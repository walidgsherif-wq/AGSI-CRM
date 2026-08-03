'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  taskCreateSchema,
  taskUpdateSchema,
  computeReminderAt,
  type ReminderKind,
  type TaskStatus,
} from '@/lib/zod/task';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

function rawFromForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  // FormData.getAll for repeated checkbox values
  const reminder_kinds = formData.getAll('reminder_kinds').map((v) => String(v));
  return {
    company_id: get('company_id'),
    project_id: get('project_id'),
    engagement_id: get('engagement_id'),
    comment_id: get('comment_id'),
    title: get('title'),
    description: get('description'),
    owner_id: get('owner_id'),
    due_date: get('due_date'),
    priority: get('priority') || 'med',
    status: get('status') || 'open',
    reminder_kinds,
    reminder_custom_at: get('reminder_custom_at'),
  };
}

async function syncReminders(
  taskId: string,
  dueDate: string | null,
  kinds: readonly ReminderKind[],
  customAt: string | null,
): Promise<string | null> {
  const sb = supabase();
  // Reconcile: delete all existing reminders, insert new ones.
  await sb.from('task_reminders').delete().eq('task_id', taskId);
  if (kinds.length === 0) return null;
  const rows = kinds
    .map((kind) => {
      const reminder_at = computeReminderAt(kind, dueDate, customAt);
      if (!reminder_at) return null;
      return { task_id: taskId, reminder_kind: kind, reminder_at };
    })
    .filter((r): r is { task_id: string; reminder_kind: ReminderKind; reminder_at: string } => r !== null);
  if (rows.length === 0) return null;
  const { error } = await sb.from('task_reminders').insert(rows);
  if (error) return error.message;
  return null;
}

/**
 * Create a follow-up task from a logged engagement.
 *
 * Loads the source engagement, then delegates to {@link createTask} via
 * synthesised FormData so every existing safeguard runs once (zod
 * validation, leadership RBAC gate, reminders, revalidation). No
 * parallel task-create path.
 *
 * The tasks table has no engagement_id FK today (verified against
 * migration 0008 + all subsequent), so the new task links to the
 * company only. If you want to surface "spawned from engagement X" on
 * the task row, that's a separate migration adding the column +
 * surfacing it in the task UI.
 */
/**
 * Create a follow-up task from a discussion comment. Mirrors
 * createFollowUpTask (from engagement) exactly — synthesises a
 * FormData and delegates to createTask so every safeguard runs.
 *
 * Pre-fills:
 *   company_id     — from the comment's company
 *   title          — "Follow up: {company}"
 *   description    — quoted preview of the source comment (first 500
 *                    chars) so the task carries context even if the
 *                    comment is later soft-deleted / the link clears.
 *   comment_id     — links the task back to the source comment.
 *   owner_id       — the current user (editable in the form later).
 */
export async function createFollowUpTaskFromComment(commentId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create tasks.' };
  const { data: c } = await supabase()
    .from('company_comments')
    .select(
      'company_id, body, company:companies!company_comments_company_id_fkey(canonical_name)',
    )
    .eq('id', commentId)
    .maybeSingle<{
      company_id: string;
      body: string;
      company: { canonical_name: string } | { canonical_name: string }[] | null;
    }>();
  if (!c) return { error: 'Comment not found.' };

  const companyName = Array.isArray(c.company)
    ? c.company[0]?.canonical_name
    : c.company?.canonical_name;
  const title = `Follow up: ${companyName ?? 'stakeholder'}`.slice(0, 280);
  const preview = (c.body ?? '').trim().slice(0, 500);
  const description = preview ? `From comment: "${preview}"` : null;

  const fd = new FormData();
  fd.append('company_id', c.company_id);
  fd.append('comment_id', commentId);
  fd.append('title', title);
  if (description) fd.append('description', description);
  fd.append('owner_id', user.id);
  fd.append('priority', 'med');
  fd.append('status', 'open');
  return createTask(fd);
}

export async function createFollowUpTask(engagementId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create tasks.' };
  const { data: eng } = await supabase()
    .from('engagements')
    .select('company_id, summary')
    .eq('id', engagementId)
    .maybeSingle<{ company_id: string; summary: string }>();
  if (!eng) return { error: 'Engagement not found.' };

  const summaryTrim = (eng.summary ?? '').trim();
  const title = `Follow up: ${summaryTrim || 'engagement'}`.slice(0, 280);

  const fd = new FormData();
  fd.append('company_id', eng.company_id);
  fd.append('title', title);
  fd.append('owner_id', user.id);
  fd.append('priority', 'med');
  fd.append('status', 'open');
  return createTask(fd);
}

export async function createTask(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create tasks.' };
  const parsed = taskCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const { reminder_kinds, reminder_custom_at, ...taskFields } = parsed.data;
  // Cross-member assignment: stamp assigned_by_id only when the
  // assigner and assignee differ. RLS (migration 0051) blocks
  // bd_manager from inserting with someone else's owner_id, so this
  // is purely metadata for the UI / audit trail.
  const isCrossAssignment = taskFields.owner_id !== user.id;
  const insert = {
    ...taskFields,
    source: 'manual' as const,
    assigned_by_id: isCrossAssignment ? user.id : null,
  };
  const { data: created, error } = await supabase()
    .from('tasks')
    .insert(insert)
    .select('id')
    .single();
  if (error || !created) return { error: error?.message ?? 'Insert failed.' };

  if (isCrossAssignment) {
    // SECURITY DEFINER fn — notifications RLS forbids direct INSERT,
    // mirroring the stagnation pattern. Self-assignments are no-ops
    // inside the fn anyway, but we skip the round-trip.
    await supabase().rpc('send_task_assigned_notification', {
      p_task_id: created.id,
      p_recipient_id: taskFields.owner_id,
    });
  }

  if (reminder_kinds.length > 0) {
    const remErr = await syncReminders(
      created.id,
      taskFields.due_date,
      reminder_kinds,
      reminder_custom_at,
    );
    if (remErr) return { error: `Task saved, but reminder setup failed: ${remErr}` };
  }

  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/tasks`);
  if (parsed.data.project_id) revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath('/tasks');
  return { ok: true };
}

export async function updateTask(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot edit tasks.' };
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };
  const parsed = taskUpdateSchema.safeParse({ id, ...rawFromForm(formData) });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const { id: _id, reminder_kinds, reminder_custom_at, ...update } = parsed.data;
  const patch: Record<string, unknown> = { ...update };
  if (update.status === 'done') patch.completed_at = new Date().toISOString();
  if (update.status && update.status !== 'done') patch.completed_at = null;
  // Re-assignment via update: if owner_id is in the patch, stamp
  // assigned_by_id (or clear it on a self-reassign). Same RLS gate
  // as create — bd_manager can't end up here with a foreign owner_id
  // because UPDATE WITH CHECK from 0022 pins owner_id to auth.uid().
  const isReassignment =
    'owner_id' in update && update.owner_id !== undefined && update.owner_id !== user.id;
  const isSelfReassignment =
    'owner_id' in update && update.owner_id === user.id;
  if (isReassignment) patch.assigned_by_id = user.id;
  else if (isSelfReassignment) patch.assigned_by_id = null;

  const { error } = await supabase().from('tasks').update(patch).eq('id', id);
  if (error) return { error: error.message };

  if (isReassignment && update.owner_id) {
    await supabase().rpc('send_task_assigned_notification', {
      p_task_id: id,
      p_recipient_id: update.owner_id,
    });
  }

  // Only re-sync reminders if the form explicitly carried reminder_kinds
  // (the global status-only inline updater doesn't carry them).
  if (reminder_kinds !== undefined) {
    const remErr = await syncReminders(
      id,
      update.due_date ?? null,
      reminder_kinds,
      reminder_custom_at ?? null,
    );
    if (remErr) return { error: `Task saved, but reminder update failed: ${remErr}` };
  }

  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/tasks`);
  revalidatePath('/tasks');
  return { ok: true };
}

export async function setTaskStatus(id: string, status: TaskStatus) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const patch: Record<string, unknown> = { status };
  if (status === 'done') patch.completed_at = new Date().toISOString();
  else patch.completed_at = null;
  const { error } = await supabase().from('tasks').update(patch).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/tasks');
  return { ok: true };
}

export async function deleteTask(id: string, contextPath?: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase().from('tasks').delete().eq('id', id);
  if (error) return { error: error.message };
  if (contextPath) revalidatePath(contextPath);
  revalidatePath('/tasks');
  return { ok: true };
}
