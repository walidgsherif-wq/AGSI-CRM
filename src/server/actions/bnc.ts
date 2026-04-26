'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth/get-user';
import type { CompanyType } from '@/types/domain';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function assertAdmin() {
  const user = await getCurrentUser();
  if (user.role !== 'admin') throw new Error('forbidden');
  return user.id;
}

/** Approve: link the suggested company to the project that triggered the queue
 *  entry. The original BNC row stays linked to the upload via bnc_upload_rows.
 *  We don't know which (project, role) triggered the queue entry without
 *  searching bnc_upload_rows for the matching raw_name — for v1 we just merge
 *  the alias and leave the project_companies link to the next upload. */
export async function approveMatch(queueId: string) {
  const userId = await assertAdmin();
  const admin = adminClient();

  const { data: queue } = await admin
    .from('company_match_queue')
    .select('id, raw_name, suggested_company_id')
    .eq('id', queueId)
    .single();
  if (!queue || !queue.suggested_company_id) {
    return { error: 'Queue entry not found or has no suggestion.' };
  }

  // Append the raw name as an alias on the suggested company so the next
  // upload's resolver auto-matches.
  const { data: company } = await admin
    .from('companies')
    .select('aliases')
    .eq('id', queue.suggested_company_id)
    .single();
  const existing: string[] = company?.aliases ?? [];
  if (!existing.some((a) => a.toLowerCase() === queue.raw_name.toLowerCase())) {
    await admin
      .from('companies')
      .update({ aliases: [...existing, queue.raw_name] })
      .eq('id', queue.suggested_company_id);
  }

  await admin
    .from('company_match_queue')
    .update({ status: 'approved', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', queueId);

  revalidatePath('/admin/companies/merge');
  return { ok: true };
}

/** Reject: mark the queue entry rejected, no DB-side mutation on companies. */
export async function rejectMatch(queueId: string) {
  const userId = await assertAdmin();
  const admin = adminClient();
  const { error } = await admin
    .from('company_match_queue')
    .update({ status: 'rejected', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', queueId);
  if (error) return { error: error.message };
  revalidatePath('/admin/companies/merge');
  return { ok: true };
}

/** Create as new: insert a new company using the raw name and mark the queue
 *  entry merged. The caller must pass a company_type (admin's choice). */
export async function createAsNew(queueId: string, companyType: CompanyType) {
  const userId = await assertAdmin();
  const admin = adminClient();

  const { data: queue } = await admin
    .from('company_match_queue')
    .select('id, raw_name, upload_id')
    .eq('id', queueId)
    .single();
  if (!queue) return { error: 'Queue entry not found.' };

  const { error: insertErr } = await admin.from('companies').insert({
    canonical_name: queue.raw_name,
    company_type: companyType,
    source: 'bnc_upload',
    current_level: 'L0',
    last_seen_in_upload_id: queue.upload_id,
    last_seen_in_upload_at: new Date().toISOString(),
  });
  if (insertErr && insertErr.code !== '23505') {
    return { error: insertErr.message };
  }

  await admin
    .from('company_match_queue')
    .update({ status: 'merged', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', queueId);

  revalidatePath('/admin/companies/merge');
  return { ok: true };
}
