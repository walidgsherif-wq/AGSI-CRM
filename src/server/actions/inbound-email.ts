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
 *  unmatched row to status='resolved'.
 *
 *  Optional: if `saveSenderAsContact` is non-null, also insert a
 *  contact on the resolved company with that email so the next email
 *  from this address auto-matches. The contact's created_by is stamped
 *  to the resolving admin. The contact insert runs AFTER the RPC so a
 *  failure to save the contact doesn't roll back a successful
 *  resolution. */
export async function resolveUnmatchedEmail(
  unmatchedId: string,
  companyId: string,
  note: string | null,
  saveSenderAsContact: { email: string; full_name: string } | null = null,
) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: 'Admin only.' };

  const sb = supabase();
  const { data, error } = await sb.rpc('resolve_inbound_email', {
    p_unmatched_id: unmatchedId,
    p_company_id: companyId,
    p_acting_user: user.id,
    p_note: note,
  });
  if (error) return { error: error.message };

  let contactSaved = false;
  let contactWarning: string | null = null;
  if (saveSenderAsContact && saveSenderAsContact.email) {
    const { error: contactErr } = await sb.from('contacts').insert({
      company_id: companyId,
      full_name: saveSenderAsContact.full_name.trim() || saveSenderAsContact.email,
      email: saveSenderAsContact.email.trim().toLowerCase(),
      is_primary: false,
      created_by: user.id,
    });
    if (contactErr) {
      // Don't fail the whole resolution if the contact already exists or
      // any other constraint fires. Surface the message instead.
      contactWarning = contactErr.message;
    } else {
      contactSaved = true;
    }
  }

  revalidatePath('/admin/inbound-email');
  revalidatePath(`/companies/${companyId}/engagements`);
  revalidatePath(`/companies/${companyId}`);
  return {
    ok: true as const,
    engagement_id: data as string,
    contact_saved: contactSaved,
    contact_warning: contactWarning,
  };
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
