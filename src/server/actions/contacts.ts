'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  contactCreateSchema,
  contactUpdateSchema,
} from '@/lib/zod/contact';

// Thin wrappers. Authorisation lives at the DB layer:
//   - INSERT/UPDATE/DELETE policies in 0073 gate role + creator scope
//   - contacts_guard_restore trigger blocks bd_manager restores
//   - contacts_enforce_single_primary trigger demotes other primaries
//   - contacts_audit trigger writes the audit_events row
// The server actions just stamp identity (created_by, deleted_by) and
// revalidate the company detail page.

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
    full_name: get('full_name'),
    position: get('position'),
    email: get('email'),
    phone: get('phone'),
  };
}

export async function createContact(formData: FormData) {
  const user = await getCurrentUser();
  const companyId = String(formData.get('company_id') ?? '');
  const isPrimary = formData.get('is_primary') === 'on';

  const parsed = contactCreateSchema.safeParse({
    company_id: companyId,
    is_primary: isPrimary,
    ...rawFromForm(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { error } = await supabase()
    .from('contacts')
    .insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: error.message };

  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const companyId = String(formData.get('company_id') ?? '');
  const isPrimary = formData.get('is_primary') === 'on';
  const parsed = contactUpdateSchema.safeParse({
    id,
    is_primary: isPrimary,
    ...rawFromForm(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { id: _id, ...patch } = parsed.data;

  // contacts_enforce_single_primary (0073) demotes any other live
  // primary on the same company when is_primary flips to true here.
  // contacts_audit writes a contact_updated row regardless.
  const { error } = await supabase()
    .from('contacts')
    .update(patch)
    .eq('id', id);
  if (error) return { error: error.message };

  if (companyId) revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

export async function archiveContact(contactId: string, companyId: string) {
  const user = await getCurrentUser();
  const { error } = await supabase()
    .from('contacts')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      is_primary: false,
    })
    .eq('id', contactId);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

export async function restoreContact(contactId: string, companyId: string) {
  // RLS UPDATE allows creator OR admin/bd_head, but the
  // contacts_guard_restore trigger raises if the caller isn't
  // admin/bd_head. The bd_manager's restore attempt errors with the
  // trigger's message.
  const { error } = await supabase()
    .from('contacts')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', contactId);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

export async function purgeContact(contactId: string, companyId: string) {
  // RLS DELETE policy enforces admin/bd_head.
  const { error } = await supabase().from('contacts').delete().eq('id', contactId);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

export async function setPrimaryContact(contactId: string, companyId: string) {
  // contacts_enforce_single_primary trigger demotes any other live
  // primary on the same company.
  const { error } = await supabase()
    .from('contacts')
    .update({ is_primary: true })
    .eq('id', contactId);
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}
