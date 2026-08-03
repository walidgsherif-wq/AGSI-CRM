'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { companyCreateSchema, companyUpdateSchema } from '@/lib/zod/company';
import { maybeProposeFromAutoHook } from '@/server/actions/sphere-proposals';

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
    location_id: get('location_id'),
    city: get('city'),
    phone: get('phone'),
    email: get('email'),
    website: get('website'),
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

/**
 * Self-serve claim: set owner_id = self on an unowned company.
 *
 * RLS for bd_manager UPDATE pins owner_id = self on both USING and
 * WITH CHECK, so claiming an unowned row from a non-owner is
 * impossible through the regular UPDATE path. The claim_company
 * RPC (migration 0071) is SECURITY DEFINER and bypasses RLS with
 * its own role gate + atomic single-UPDATE race guard.
 *
 * Returns { ok: true } or { error: '…' } — never throws.
 */
export async function claimCompany(companyId: string, locationId: string) {
  const user = await getCurrentUser();
  // Echoed server-side so the UI fail-closed before any RPC round-trip
  // if a leadership session somehow reaches this action.
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot claim companies.' };
  }
  if (!locationId) {
    return { error: 'Select an emirate to claim this stakeholder.' };
  }

  const { error } = await supabaseFromRequest().rpc('claim_company', {
    p_company_id: companyId,
    p_location_id: locationId,
  });
  if (error) return { error: error.message };

  // Sphere-of-interest curation prompt (0098): when a bd_manager
  // claims an off-sphere company, auto-create a pending proposal
  // for admin/bd_head. Best-effort — never blocks the claim. Dedup
  // + role-gate live inside the helper.
  await maybeProposeFromAutoHook(companyId, 'claimed_off_sphere');

  revalidatePath('/companies');
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}

/**
 * Inverse of claimCompany: release a stakeholder back to unclaimed.
 *
 * The unclaim_company RPC (0076) is SECURITY DEFINER and enforces:
 *   - non-leadership / non-anon
 *   - non-empty reason
 *   - caller is the current owner OR admin/bd_head
 *   - row is currently claimed (race-guarded by the UPDATE WHERE)
 * It also writes the audit_events row and the bd_head/admin
 * notifications, so this action is a thin wrapper.
 */
export async function unclaimCompany(companyId: string, reason: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot release companies.' };
  }
  if (!reason || !reason.trim()) {
    return { error: 'A reason is required to release a stakeholder.' };
  }

  const { error } = await supabaseFromRequest().rpc('unclaim_company', {
    p_company_id: companyId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidatePath('/companies');
  revalidatePath(`/companies/${companyId}`);
  return { ok: true as const };
}
