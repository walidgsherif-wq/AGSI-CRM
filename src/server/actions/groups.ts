'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Request to group one or more child companies under a parent
 * (holding) company. Pending until an admin approves via
 * approve_company_group_request RPC. Never destructive — children
 * stay fully visible everywhere.
 */
export async function requestCompanyGroup(input: {
  parent_company_id: string;
  child_company_ids: string[];
  reason?: string | null;
}) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return { error: 'Leadership cannot request grouping.' };
  }
  const parent = input.parent_company_id?.trim();
  const children = (input.child_company_ids ?? [])
    .map((s) => s?.trim())
    .filter(Boolean);
  if (!parent) return { error: 'Pick a parent (holding) company.' };
  if (children.length === 0) {
    return { error: 'Pick at least one child company to group.' };
  }
  if (children.includes(parent)) {
    return { error: 'A company cannot be its own parent.' };
  }

  const { error } = await supabase().from('company_group_requests').insert({
    parent_company_id: parent,
    child_company_ids: children,
    requested_by: user.id,
    reason: input.reason?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/companies/${parent}`);
  for (const c of children) revalidatePath(`/companies/${c}`);
  revalidatePath('/admin/group-requests');
  return { ok: true as const };
}

export async function approveGroupRequest(
  requestId: string,
  reviewNote: string | null,
) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admins can approve.' };
  const { error } = await supabase().rpc('approve_company_group_request', {
    p_request_id: requestId,
    p_review_note: reviewNote,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/group-requests');
  revalidatePath('/companies');
  return { ok: true as const };
}

export async function rejectGroupRequest(
  requestId: string,
  reviewNote: string,
) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admins can reject.' };
  if (!reviewNote.trim()) {
    return { error: 'A reason is required when rejecting.' };
  }
  const { error } = await supabase().rpc('reject_company_group_request', {
    p_request_id: requestId,
    p_review_note: reviewNote,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/group-requests');
  return { ok: true as const };
}

/**
 * Admin-only direct ungroup — null the parent_company_id on a child.
 * Non-destructive and reversible, so no request workflow needed.
 */
export async function ungroupChild(childId: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') {
    return { error: 'Only admins can ungroup.' };
  }
  const { error } = await supabase()
    .from('companies')
    .update({ parent_company_id: null })
    .eq('id', childId);
  if (error) return { error: error.message };

  revalidatePath(`/companies/${childId}`);
  revalidatePath('/companies');
  return { ok: true as const };
}
