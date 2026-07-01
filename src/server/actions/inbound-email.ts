'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  collectCandidates,
  domainFromWebsite,
  extractHeadersFromRawPayload,
  inferCounterpartyDomain,
  selectHarvest,
} from '@/lib/inbound-email/harvest';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type ResolveHarvestSummary = {
  /** Total addresses considered from From + To + CC after normalising. */
  candidates_considered: number;
  /** Counterparty domain used to scope the harvest, if any. */
  counterparty_domain: string | null;
  /** Actually added on this call. */
  added: Array<{ email: string; full_name: string }>;
  /** Auto-added but blocked by a duplicate / RLS error — surfaced so the
   *  admin knows the DB rejected one. */
  skipped_duplicates: number;
  /** Set when the company's email_domain column was null before this
   *  call and we filled it in based on the inferred counterparty. */
  learned_domain: string | null;
  /** Human note when we chose not to harvest (e.g. no external domain,
   *  or a tie between two external domains). Empty on the happy path. */
  reason: string | null;
};

/** Admin manually associates an unmatched email with a company. The RPC
 *  creates the engagement + engagement_emails rows and flips the
 *  unmatched row to status='resolved'.
 *
 *  Then domain-scoped counterparty-contact harvesting runs:
 *    - collect all addresses from From + To + CC (+ raw_payload display
 *      names when present)
 *    - drop internal (@agsi.ae) and role addresses
 *    - infer the counterparty domain (existing column → website →
 *      inferred majority), refuse to guess on a tie
 *    - dedup against the company's existing live contacts by email
 *    - insert what survives, flagged needs_details=true so it surfaces
 *      as "Needs details" on the Contacts section
 *    - learn the company's email_domain if it was null
 *
 *  The harvest runs after a successful resolve so a harvest hiccup
 *  never rolls back the engagement creation. */
export async function resolveUnmatchedEmail(
  unmatchedId: string,
  companyId: string,
  note: string | null,
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

  const harvest = await harvestContactsForResolve(sb, unmatchedId, companyId, user.id);

  revalidatePath('/admin/inbound-email');
  revalidatePath(`/companies/${companyId}/engagements`);
  revalidatePath(`/companies/${companyId}`);
  return {
    ok: true as const,
    engagement_id: data as string,
    harvest,
  };
}

type UnmatchedRow = {
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  raw_payload: unknown;
};

type CompanySnapshot = {
  id: string;
  website: string | null;
  email_domain: string | null;
};

/**
 * Domain-scoped harvest. Never throws: any Postgres error inserting
 * a single contact is logged in `skipped_duplicates` and the resolve
 * itself still returns ok. Keeps admin unblocked when only one address
 * is problematic.
 */
async function harvestContactsForResolve(
  sb: ReturnType<typeof supabase>,
  unmatchedId: string,
  companyId: string,
  actingUserId: string,
): Promise<ResolveHarvestSummary> {
  const summary: ResolveHarvestSummary = {
    candidates_considered: 0,
    counterparty_domain: null,
    added: [],
    skipped_duplicates: 0,
    learned_domain: null,
    reason: null,
  };

  const { data: unmatched } = await sb
    .from('inbound_email_unmatched')
    .select('from_email, from_name, to_emails, cc_emails, raw_payload')
    .eq('id', unmatchedId)
    .maybeSingle<UnmatchedRow>();

  if (!unmatched) {
    summary.reason = 'Unmatched row not readable — no harvest attempted.';
    return summary;
  }

  const headers = extractHeadersFromRawPayload(unmatched.raw_payload);
  const candidates = collectCandidates({
    from_email: unmatched.from_email,
    from_name: unmatched.from_name,
    to_emails: unmatched.to_emails ?? [],
    cc_emails: unmatched.cc_emails ?? [],
    headers,
  });
  summary.candidates_considered = candidates.length;

  const { data: company } = await sb
    .from('companies')
    .select('id, website, email_domain')
    .eq('id', companyId)
    .maybeSingle<CompanySnapshot>();

  const preferredDomain =
    (company?.email_domain ?? '').trim().toLowerCase() ||
    domainFromWebsite(company?.website ?? null) ||
    inferCounterpartyDomain(candidates);

  if (!preferredDomain) {
    summary.reason =
      'No counterparty domain could be inferred (only internal or role addresses, or an ambiguous mix of external domains).';
    return summary;
  }
  summary.counterparty_domain = preferredDomain;

  // Existing live contacts on the company — used for dedup.
  const { data: existingContacts } = await sb
    .from('contacts')
    .select('email')
    .eq('company_id', companyId)
    .is('deleted_at', null);
  const existingLive = new Set<string>(
    (existingContacts ?? [])
      .map((c) => (c.email ?? '').trim().toLowerCase())
      .filter((e) => e.length > 0),
  );

  const toInsert = selectHarvest(candidates, preferredDomain, existingLive);
  if (toInsert.length === 0) {
    summary.reason =
      'Every counterparty-domain address on this email was already recorded as a live contact.';
  }

  for (const row of toInsert) {
    const { error: insertErr } = await sb.from('contacts').insert({
      company_id: companyId,
      full_name: row.full_name,
      email: row.email,
      is_primary: false,
      needs_details: true,
      created_by: actingUserId,
    });
    if (insertErr) {
      // Race with a parallel insert or a DB-level constraint fired
      // (e.g. contact created between our dedup read and this insert).
      // Count and move on so one address's problem doesn't skip the rest.
      summary.skipped_duplicates += 1;
      continue;
    }
    summary.added.push(row);
  }

  // Learn the domain — only when the column was null and we have a
  // clean inferred value we actually used to harvest.
  if (!company?.email_domain && preferredDomain) {
    const { error: updateErr } = await sb
      .from('companies')
      .update({ email_domain: preferredDomain })
      .eq('id', companyId)
      .is('email_domain', null);
    if (!updateErr) summary.learned_domain = preferredDomain;
  }

  return summary;
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
