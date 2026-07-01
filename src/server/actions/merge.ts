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

export type MergeFieldChoices = Partial<
  Record<
    | 'level'
    | 'owner_id'
    | 'phone'
    | 'email'
    | 'website'
    | 'location_id'
    | 'country'
    | 'is_key_stakeholder'
    | 'parent_company_id',
    'survivor' | 'absorbed'
  >
>;

/**
 * Collapse an absorbed company into a survivor. See migration 0084
 * for the semantics — RPC handles re-pointing, dedup, grouping, and
 * writes the provenance manifest.
 */
export async function mergeCompanies(input: {
  survivorId: string;
  absorbedId: string;
  fieldChoices: MergeFieldChoices;
}) {
  await getCurrentUser();
  const { data, error } = await supabase().rpc('merge_companies', {
    p_survivor: input.survivorId,
    p_absorbed: [input.absorbedId],
    p_field_choices: input.fieldChoices as unknown as Record<string, string>,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/companies/duplicates');
  revalidatePath('/companies');
  revalidatePath(`/companies/${input.survivorId}`);
  revalidatePath(`/companies/${input.absorbedId}`);
  return { ok: true as const, mergeId: data as string };
}

/**
 * Mark a pair as verified distinct — suppresses future finder
 * suggestions of the same pair. Canonical ordering handled in the RPC.
 */
export async function markCompaniesDistinct(input: {
  aId: string;
  bId: string;
  reason?: string | null;
}) {
  await getCurrentUser();
  const { error } = await supabase().rpc('mark_companies_distinct', {
    p_a: input.aId,
    p_b: input.bId,
    p_reason: input.reason ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/companies/duplicates');
  return { ok: true as const };
}
