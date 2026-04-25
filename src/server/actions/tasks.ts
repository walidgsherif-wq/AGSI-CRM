'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { taskCreateSchema, taskUpdateSchema, type TaskStatus } from '@/lib/zod/task';

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
  return {
    company_id: get('company_id'),
    project_id: get('project_id'),
    title: get('title'),
    description: get('description'),
    owner_id: get('owner_id'),
    due_date: get('due_date'),
    priority: get('priority') || 'med',
    status: get('status') || 'open',
  };
}

export async function createTask(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create tasks.' };
  const parsed = taskCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const insert = { ...parsed.data, source: 'manual' as const };
  const { error } = await supabase().from('tasks').insert(insert);
  if (error) return { error: error.message };

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

  const { id: _id, ...update } = parsed.data;
  // Auto-stamp completed_at when status flips to done
  const patch: Record<string, unknown> = { ...update };
  if (update.status === 'done') patch.completed_at = new Date().toISOString();
  if (update.status && update.status !== 'done') patch.completed_at = null;

  const { error } = await supabase().from('tasks').update(patch).eq('id', id);
  if (error) return { error: error.message };
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
