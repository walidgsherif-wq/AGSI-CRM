'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { noteCreateSchema, noteUpdateSchema } from '@/lib/zod/note';

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
    body: get('body'),
    is_pinned: formData.get('is_pinned') === 'on',
  };
}

export async function createNote(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create notes.' };
  const parsed = noteCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const { error } = await supabase()
    .from('notes')
    .insert({ ...parsed.data, author_id: user.id });
  if (error) return { error: error.message };
  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/notes`);
  return { ok: true };
}

export async function updateNote(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot edit notes.' };
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };
  const parsed = noteUpdateSchema.safeParse({
    id,
    body: String(formData.get('body') ?? ''),
    is_pinned: formData.get('is_pinned') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  const { id: _id, ...update } = parsed.data;
  const { error } = await supabase().from('notes').update(update).eq('id', id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteNote(id: string, companyId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase().from('notes').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/notes`);
  return { ok: true };
}

export async function togglePin(id: string, isPinned: boolean, companyId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase().from('notes').update({ is_pinned: isPinned }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/notes`);
  return { ok: true };
}
