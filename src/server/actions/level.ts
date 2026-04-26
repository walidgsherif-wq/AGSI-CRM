'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import type { Level } from '@/types/domain';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

const VALID_LEVELS: Level[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

/**
 * Direct level change (admin only). Bypasses the approval queue —
 * used when admin wants to correct a level themselves.
 */
export async function changeCompanyLevel(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') {
    return { error: 'Only admins can change levels directly. Submit a request instead.' };
  }

  const companyId = String(formData.get('company_id') ?? '');
  const toLevel = String(formData.get('to_level') ?? '') as Level;
  const evidenceNote = String(formData.get('evidence_note') ?? '').trim();
  const evidenceFileUrl = String(formData.get('evidence_file_url') ?? '').trim() || null;

  if (!companyId) return { error: 'Missing company_id.' };
  if (!VALID_LEVELS.includes(toLevel)) return { error: 'Invalid to_level.' };
  if (!evidenceNote) return { error: 'Evidence note is required.' };

  const { data, error } = await supabase().rpc('change_company_level', {
    p_company_id: companyId,
    p_to_level: toLevel,
    p_evidence_note: evidenceNote,
    p_evidence_file_url: evidenceFileUrl,
  });

  if (error) return { error: error.message };
  revalidatePath('/pipeline');
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/companies/${companyId}/level-history`);
  return { ok: true, history_id: data as string };
}

/**
 * Submit a level change for admin approval. Used by bd_manager and
 * bd_head. Files must be uploaded to the evidence bucket BEFORE calling
 * this — pass the resulting storage paths in the form.
 *
 * Ownership rule: only admin or the company's current owner may request.
 * Members can't progress stakeholders they're not assigned to.
 */
export async function requestLevelChange(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot request level changes.' };

  const companyId = String(formData.get('company_id') ?? '');
  const fromLevel = String(formData.get('from_level') ?? '') as Level;
  const toLevel = String(formData.get('to_level') ?? '') as Level;
  const evidenceNote = String(formData.get('evidence_note') ?? '').trim();
  const evidenceFilePaths = formData
    .getAll('evidence_file_paths')
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  if (!companyId) return { error: 'Missing company_id.' };
  if (!VALID_LEVELS.includes(fromLevel) || !VALID_LEVELS.includes(toLevel)) {
    return { error: 'Invalid level.' };
  }
  if (fromLevel === toLevel) return { error: 'From and to levels must differ.' };
  if (!evidenceNote) return { error: 'Evidence note is required.' };

  const sb = supabase();

  // Ownership check
  if (user.role !== 'admin') {
    const { data: company } = await sb
      .from('companies')
      .select('owner_id')
      .eq('id', companyId)
      .single();
    if (!company) return { error: 'Company not found.' };
    if (company.owner_id !== user.id) {
      return {
        error: 'You can only progress stakeholders you own. Ask the owner or an admin.',
      };
    }
  }

  const { error } = await sb.from('level_change_requests').insert({
    company_id: companyId,
    from_level: fromLevel,
    to_level: toLevel,
    requested_by: user.id,
    evidence_note: evidenceNote,
    evidence_file_paths: evidenceFilePaths,
  });

  if (error) return { error: error.message };
  revalidatePath('/pipeline');
  revalidatePath(`/companies/${companyId}/level-history`);
  revalidatePath('/admin/level-requests');
  return { ok: true };
}

export async function approveLevelRequest(requestId: string, reviewNote: string | null) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admins can approve.' };
  const { error } = await supabase().rpc('approve_level_change_request', {
    p_request_id: requestId,
    p_review_note: reviewNote,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/level-requests');
  revalidatePath('/pipeline');
  return { ok: true };
}

export async function rejectLevelRequest(requestId: string, reviewNote: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admins can reject.' };
  if (!reviewNote.trim()) return { error: 'A review note is required when rejecting.' };
  const { error } = await supabase().rpc('reject_level_change_request', {
    p_request_id: requestId,
    p_review_note: reviewNote,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/level-requests');
  return { ok: true };
}

export async function cancelLevelRequest(requestId: string, companyId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase()
    .from('level_change_requests')
    .update({ status: 'cancelled', reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/level-history`);
  revalidatePath('/admin/level-requests');
  return { ok: true };
}

export async function transferOwnership(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Only admins can transfer ownership.' };

  const companyId = String(formData.get('company_id') ?? '');
  const newOwnerId = String(formData.get('new_owner_id') ?? '');
  const transferCredit = formData.get('transfer_credit') === 'on';

  if (!companyId || !newOwnerId) return { error: 'Missing company_id or new_owner_id.' };

  const { data, error } = await supabase().rpc('transfer_company_ownership', {
    p_company_id: companyId,
    p_new_owner_id: newOwnerId,
    p_transfer_credit: transferCredit,
  });

  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/companies/${companyId}/ownership-timeline`);
  revalidatePath('/pipeline');
  return { ok: true, rows_reattributed: data as number };
}

export async function setLevelHistoryCredited(historyId: string, isCredited: boolean) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const { data, error } = await supabase()
    .from('level_history')
    .update({ is_credited: isCredited })
    .eq('id', historyId)
    .select('company_id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Update failed.' };

  revalidatePath(`/companies/${data.company_id}/level-history`);
  return { ok: true };
}
