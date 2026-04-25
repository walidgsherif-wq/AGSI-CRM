'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { companyCreateSchema, companyUpdateSchema } from '@/lib/zod/company';

function supabaseFromRequest() {
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
    canonical_name: get('canonical_name'),
    company_type: get('company_type'),
    country: get('country') || 'United Arab Emirates',
    city: get('city'),
    phone: get('phone'),
    email: get('email'),
    website: get('website'),
    key_contact_name: get('key_contact_name'),
    key_contact_role: get('key_contact_role'),
    key_contact_email: get('key_contact_email'),
    key_contact_phone: get('key_contact_phone'),
    notes_internal: get('notes_internal'),
    is_key_stakeholder: formData.get('is_key_stakeholder') === 'on',
    owner_id: get('owner_id'),
  };
}

export async function createCompany(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot create companies.' };
  }

  const parsed = companyCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  // bd_manager defaults to owning what they create unless someone else picked
  const data = { ...parsed.data };
  if (user.role === 'bd_manager' && !data.owner_id) {
    data.owner_id = user.id;
  }

  const supabase = supabaseFromRequest();
  const insertPayload = {
    ...data,
    owner_assigned_at: data.owner_id ? new Date().toISOString() : null,
    source: 'manual' as const,
  };

  const { data: row, error } = await supabase
    .from('companies')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { error: 'A company with this name already exists.' };
    }
    return { error: error.message };
  }

  revalidatePath('/companies');
  redirect(`/companies/${row.id}`);
}

export async function updateCompany(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot edit companies.' };
  }

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };

  const parsed = companyUpdateSchema.safeParse({ id, ...rawFromForm(formData) });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  // owner_id change stamps owner_assigned_at; otherwise leave alone
  const { id: _id, ...update } = parsed.data;
  const supabase = supabaseFromRequest();

  // If owner_id is provided AND changed, stamp owner_assigned_at
  if ('owner_id' in update && update.owner_id) {
    (update as Record<string, unknown>).owner_assigned_at = new Date().toISOString();
  }

  const { error } = await supabase.from('companies').update(update).eq('id', id);
  if (error) {
    if (error.code === '23505') {
      return { error: 'A company with this name already exists.' };
    }
    return { error: error.message };
  }

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
  return { ok: true };
}
