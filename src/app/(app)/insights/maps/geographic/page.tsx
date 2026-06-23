import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { GeographicHeatMap } from './_components/GeographicHeatMap';
import type { Level } from '@/types/domain';
import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

type CompanyRow = {
  id: string;
  canonical_name: string;
  location_id: string | null;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  has_active_projects: boolean;
};

type LocationRow = {
  id: string;
  city_name: string;
  emirate: string;
  latitude: number;
  longitude: number;
};

export default async function GeographicMapPage() {
  // Layout enforces requireRole(['admin','leadership','bd_head']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Map now resolves coords only via the controlled FK — companies.city
  // (free text) is no longer in the pipeline. Unmatched companies
  // (location_id IS NULL) surface as the "not placed" count.
  const [companiesRes, locationsRes] = await Promise.all([
    supabase
      .from('companies')
      .select(
        'id, canonical_name, location_id, company_type, current_level, has_active_projects',
      )
      .eq('is_active', true)
      .returns<CompanyRow[]>(),
    supabase
      .from('city_lookup')
      .select('id, city_name, emirate, latitude, longitude')
      .eq('is_active', true)
      .returns<LocationRow[]>(),
  ]);

  const companies = companiesRes.data ?? [];
  const locations = (locationsRes.data ?? []).map((l) => ({
    ...l,
    latitude: Number(l.latitude),
    longitude: Number(l.longitude),
  }));

  return <GeographicHeatMap companies={companies} locations={locations} />;
}
