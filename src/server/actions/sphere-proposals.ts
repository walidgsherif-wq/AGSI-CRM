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

export type SphereProposalReason =
  | 'engaged_off_sphere'
  | 'claimed_off_sphere'
  | 'manual';

/**
 * Propose a company for the sphere of interest.
 *
 * Returns:
 *   { proposed: true, id }        — a new pending proposal was created.
 *   { proposed: false, reason: … } — the RPC deduplicated (already a
 *                                    member / already pending / already
 *                                    rejected). Callers surface this as
 *                                    a legible message.
 *   { error }                     — RPC / auth failure.
 *
 * Safe to call from best-effort auto-hooks — the RPC never raises on
 * dedup, so a manager engaging or claiming an off-sphere company
 * always proceeds even when the proposal is a no-op.
 */
export async function proposeForSphere(
  companyId: string,
  reason: SphereProposalReason,
  note?: string | null,
): Promise<
  | { proposed: true; id: string }
  | { proposed: false; reason: 'already-covered' | 'already-pending' | 'already-rejected' }
  | { error: string }
> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head', 'bd_manager'].includes(user.role)) {
    return { error: 'Only BD team members can propose sphere additions.' };
  }

  const sb = supabase();
  const { data, error } = await sb.rpc('propose_for_sphere', {
    p_company_id: companyId,
    p_reason: reason,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };

  const id = data as string | null;
  if (id) {
    revalidatePath('/sphere');
    revalidatePath(`/companies/${companyId}`);
    return { proposed: true, id };
  }

  // RPC returned NULL — dedup path. Classify against the DB so the UI
  // can render a truthful reason ("already in your sphere" vs "pending
  // review" vs "previously rejected — ask an admin to add manually").
  const [{ count: memberCount }, { count: pendingCount }, { count: rejectedCount }] =
    await Promise.all([
      sb
        .from('sphere_members')
        .select('company_id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      sb
        .from('sphere_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'pending'),
      sb
        .from('sphere_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'rejected'),
    ]);
  if ((memberCount ?? 0) > 0) return { proposed: false, reason: 'already-covered' };
  if ((pendingCount ?? 0) > 0) return { proposed: false, reason: 'already-pending' };
  if ((rejectedCount ?? 0) > 0) return { proposed: false, reason: 'already-rejected' };
  // Shouldn't happen — the RPC only returns NULL on one of the above.
  return { proposed: false, reason: 'already-covered' };
}

export async function approveSphereProposal(
  proposalId: string,
  reviewNote?: string | null,
): Promise<{ ok: true; companyId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return { error: 'Only admin or bd_head can decide sphere proposals.' };
  }
  const { data, error } = await supabase().rpc('approve_sphere_proposal', {
    p_proposal_id: proposalId,
    p_review_note: reviewNote ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/sphere');
  revalidatePath('/notifications');
  return { ok: true, companyId: data as string };
}

export async function rejectSphereProposal(
  proposalId: string,
  reviewNote: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head'].includes(user.role)) {
    return { error: 'Only admin or bd_head can decide sphere proposals.' };
  }
  if (!reviewNote.trim()) {
    return { error: 'A reason is required when rejecting.' };
  }
  const { error } = await supabase().rpc('reject_sphere_proposal', {
    p_proposal_id: proposalId,
    p_review_note: reviewNote,
  });
  if (error) return { error: error.message };
  revalidatePath('/sphere');
  revalidatePath('/notifications');
  return { ok: true };
}

/**
 * Best-effort proposal from an auto-hook (engagement / claim). Never
 * raises — logs a soft error and returns silently so the caller
 * (createEngagement / claimCompany) proceeds regardless.
 *
 * Only bd_manager calls trigger auto-proposals; admin/bd_head engaging
 * an off-sphere company is expected to use the builder directly if
 * they want to add it.
 */
export async function maybeProposeFromAutoHook(
  companyId: string,
  reason: 'engaged_off_sphere' | 'claimed_off_sphere',
): Promise<void> {
  const user = await getCurrentUser();
  if (user.role !== 'bd_manager') return;
  try {
    await supabase().rpc('propose_for_sphere', {
      p_company_id: companyId,
      p_reason: reason,
      p_note: null,
    });
  } catch (err) {
    // Swallow — the engagement/claim already committed. A missing
    // proposal is recoverable via the manual button on the stakeholder
    // page.
    console.error('[sphere-proposal] auto-hook failed', {
      companyId,
      reason,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
