import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { GeographicHeatMap } from './_components/GeographicHeatMap';
import { LEVELS, type Level } from '@/types/domain';
import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

const DEFAULT_MIN_LEVEL: Level = 'L2';

function parseMinLevel(raw: string | undefined): Level {
  if (!raw) return DEFAULT_MIN_LEVEL;
  return (LEVELS as readonly string[]).includes(raw)
    ? (raw as Level)
    : DEFAULT_MIN_LEVEL;
}

function levelsAtOrAbove(min: Level): Level[] {
  const idx = LEVELS.indexOf(min);
  return LEVELS.slice(idx) as Level[];
}

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

export default async function GeographicMapPage({
  searchParams,
}: {
  searchParams: { min_level?: string };
}) {
  // Layout enforces requireRole(['admin','leadership','bd_head']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const minLevel = parseMinLevel(searchParams.min_level);
  const allowedLevels = levelsAtOrAbove(minLevel);

  // Scope: companies at or above the selected threshold. Default L2+
  // since L0/L1 are either market dossier (BNC) or first-touch leads
  // that don't yet belong on a relationship map. Paginated fetch
  // because Supabase silently caps a single request at 1000 rows;
  // mirrors the pattern in /pipeline.
  const PAGE_SIZE = 1000;
  const HARD_CAP = 20_000;
  const companies: CompanyRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
    const { data: batch } = await supabase
      .from('companies')
      .select(
        'id, canonical_name, location_id, company_type, current_level, has_active_projects',
      )
      .eq('is_active', true)
      .in('current_level', allowedLevels)
      .order('canonical_name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<CompanyRow[]>();
    const rows = batch ?? [];
    companies.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const { data: locationsRaw } = await supabase
    .from('city_lookup')
    .select('id, city_name, emirate, latitude, longitude')
    .eq('is_active', true)
    .returns<LocationRow[]>();

  const locations = (locationsRaw ?? []).map((l) => ({
    ...l,
    latitude: Number(l.latitude),
    longitude: Number(l.longitude),
  }));

  return (
    <GeographicHeatMap
      companies={companies}
      locations={locations}
      minLevel={minLevel}
    />
  );
}
