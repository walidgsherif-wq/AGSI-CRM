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

/** Admin manually associates an unmatched email with a company. The RPC
 *  creates the engagement + engagement_emails rows and flips the
 *  unmatched row to status='resolved'. */
export async function resolveUnmatchedEmail(
  unmatchedId: string,
  companyId: string,
  note: string | null,
) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const { data, error } = await supabase().rpc('resolve_inbound_email', {
    p_unmatched_id: unmatchedId,
    p_company_id: companyId,
    p_acting_user: user.id,
    p_note: note,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/inbound-email');
  revalidatePath(`/companies/${companyId}/engagements`);
  return { ok: true, engagement_id: data as string };
}

export async function discardUnmatchedEmail(unmatchedId: string, note: string) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };
  const { error } = await supabase()
    .from('inbound_email_unmatched')
    .update({
      status: 'discarded',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      review_note: note,
    })
    .eq('id', unmatchedId)
    .eq('status', 'pending');
  if (error) return { error: error.message };
  revalidatePath('/admin/inbound-email');
  return { ok: true };
}
