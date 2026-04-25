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

export async function createTask(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create tasks.' };
  const parsed = taskCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const { reminder_kinds, reminder_custom_at, ...taskFields } = parsed.data;
  const insert = { ...taskFields, source: 'manual' as const };
  const { data: created, error } = await supabase()
    .from('tasks')
    .insert(insert)
    .select('id')
    .single();
  if (error || !created) return { error: error?.message ?? 'Insert failed.' };

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

  const { error } = await supabase().from('tasks').update(patch).eq('id', id);
  if (error) return { error: error.message };

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
