'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { documentCreateSchema, documentUpdateSchema } from '@/lib/zod/document';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Called AFTER the browser has uploaded the file to the `documents` bucket.
 * Storage path is the source of truth — we just register the metadata row.
 */
export async function createDocument(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create documents.' };

  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  const parsed = documentCreateSchema.safeParse({
    company_id: get('company_id'),
    project_id: get('project_id'),
    doc_type: get('doc_type'),
    title: get('title'),
    storage_path: get('storage_path'),
    signed_date: get('signed_date'),
    expiry_date: get('expiry_date'),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };

  const { error } = await supabase()
    .from('documents')
    .insert({ ...parsed.data, uploaded_by: user.id });
  if (error) return { error: error.message };
  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/documents`);
  return { ok: true };
}

export async function updateDocument(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot edit documents.' };
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  const parsed = documentUpdateSchema.safeParse({
    id,
    title: get('title'),
    doc_type: get('doc_type'),
    signed_date: get('signed_date'),
    expiry_date: get('expiry_date'),
    is_archived: formData.get('is_archived') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  const { id: _id, ...update } = parsed.data;
  const patch: Record<string, unknown> = { ...update };
  // archive timestamping
  if (update.is_archived === true) {
    patch.archived_at = new Date().toISOString();
    patch.archived_reason = 'admin_manual';
  }
  if (update.is_archived === false) {
    patch.archived_at = null;
    patch.archived_reason = null;
  }
  const { error } = await supabase().from('documents').update(patch).eq('id', id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteDocument(id: string, companyId: string, storagePath: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const sb = supabase();
  await sb.storage.from('documents').remove([storagePath]);
  const { error } = await sb.from('documents').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/documents`);
  return { ok: true };
}
