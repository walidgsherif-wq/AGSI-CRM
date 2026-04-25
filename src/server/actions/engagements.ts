'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { engagementCreateSchema, engagementUpdateSchema } from '@/lib/zod/engagement';

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
    engagement_type: get('engagement_type'),
    summary: get('summary'),
    engagement_date: get('engagement_date'),
  };
}

export async function createEngagement(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create engagements.' };

  const parsed = engagementCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { error } = await supabase()
    .from('engagements')
    .insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: error.message };
  revalidatePath(`/companies/${parsed.data.company_id}/engagements`);
  return { ok: true };
}

export async function updateEngagement(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot edit engagements.' };
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };
  const parsed = engagementUpdateSchema.safeParse({ id, ...rawFromForm(formData) });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  const { id: _id, ...update } = parsed.data;
  const { error } = await supabase().from('engagements').update(update).eq('id', id);
  if (error) return { error: error.message };
  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/engagements`);
  return { ok: true };
}

export async function deleteEngagement(id: string, companyId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase().from('engagements').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/engagements`);
  return { ok: true };
}
