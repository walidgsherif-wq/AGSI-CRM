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

export async function changeCompanyLevel(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot change levels.' };

  const companyId = String(formData.get('company_id') ?? '');
  const toLevel = String(formData.get('to_level') ?? '') as Level;
  const evidenceNote = String(formData.get('evidence_note') ?? '').trim() || null;
  const evidenceFileUrl = String(formData.get('evidence_file_url') ?? '').trim() || null;

  if (!companyId) return { error: 'Missing company_id.' };
  if (!VALID_LEVELS.includes(toLevel)) return { error: 'Invalid to_level.' };

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
