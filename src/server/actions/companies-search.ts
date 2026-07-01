'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { COMPANY_TYPES } from '@/lib/zod/company';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

export type CompanySearchHit = {
  id: string;
  canonical_name: string;
  company_type: (typeof COMPANY_TYPES)[number];
  emirate: string | null;
};

// PostgREST embed can return the FK target as either an object or a
// single-element array depending on cardinality inference. Normalising
// server-side so the client only sees one shape.
type Raw = {
  id: string;
  canonical_name: string;
  company_type: (typeof COMPANY_TYPES)[number];
  location:
    | { emirate: string | null }
    | { emirate: string | null }[]
    | null;
};

/**
 * Type-to-search company lookup for the inbound-email resolver's
 * picker. Server-side ilike on canonical_name so the full active,
 * non-merged universe (~3.6k rows) is reachable without preloading.
 *
 * Filters:
 *   - is_active = true              (matches the existing resolver preload)
 *   - merged_into_company_id IS NULL (never suggest an absorbed record)
 *
 * Returns the top `limit` (default 20) alphabetical matches. An empty
 * query returns an empty list rather than the alphabetical head — the
 * combobox uses the empty case to show its own placeholder instead of
 * pretending everything is a match.
 */
export async function searchCompaniesForResolver(
  query: string,
  limit = 20,
): Promise<CompanySearchHit[]> {
  await getCurrentUser();
  const q = query.trim();
  if (q.length === 0) return [];

  const cap = Math.min(Math.max(limit, 1), 50);
  const sb = supabase();
  const { data } = await sb
    .from('companies')
    .select(
      'id, canonical_name, company_type, location:city_lookup(emirate)',
    )
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .ilike('canonical_name', `%${q}%`)
    .order('canonical_name', { ascending: true })
    .limit(cap)
    .returns<Raw[]>();

  return (data ?? []).map<CompanySearchHit>((r) => {
    const loc = Array.isArray(r.location) ? (r.location[0] ?? null) : r.location;
    return {
      id: r.id,
      canonical_name: r.canonical_name,
      company_type: r.company_type,
      emirate: loc?.emirate ?? null,
    };
  });
}

/**
 * Fetch a single company by id — used to hydrate the combobox display
 * label when a value is already selected (e.g. after a router refresh).
 * Returns null if the id is unknown or the row is inactive/merged.
 */
export async function getCompanyForResolver(
  id: string,
): Promise<CompanySearchHit | null> {
  await getCurrentUser();
  const sb = supabase();
  const { data } = await sb
    .from('companies')
    .select(
      'id, canonical_name, company_type, location:city_lookup(emirate)',
    )
    .eq('id', id)
    .eq('is_active', true)
    .is('merged_into_company_id', null)
    .maybeSingle<Raw>();
  if (!data) return null;
  const loc = Array.isArray(data.location)
    ? (data.location[0] ?? null)
    : data.location;
  return {
    id: data.id,
    canonical_name: data.canonical_name,
    company_type: data.company_type,
    emirate: loc?.emirate ?? null,
  };
}
