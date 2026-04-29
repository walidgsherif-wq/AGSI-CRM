import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { LevelDistributionHeatMap } from './_components/LevelDistributionHeatMap';
import type { Level } from '@/types/domain';
import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

type CompanyRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  is_key_stakeholder: boolean | null;
  has_active_projects: boolean;
};

type UniverseSizes = {
  developers: number;
  consultants: number;
  main_contractors: number;
  enabling_contractors: number;
  total: number;
};

export default async function LevelDistributionMapPage() {
  // Layout enforces requireRole(['admin','leadership','bd_head']).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [companiesRes, universeRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, canonical_name, company_type, current_level, is_key_stakeholder, has_active_projects')
      .eq('is_active', true)
      .eq('is_in_kpi_universe', true)
      .order('canonical_name')
      .returns<CompanyRow[]>(),
    supabase
      .from('app_settings')
      .select('value_json')
      .eq('key', 'kpi_universe_sizes')
      .maybeSingle<{ value_json: UniverseSizes }>(),
  ]);

  const universe: UniverseSizes = universeRes.data?.value_json ?? {
    developers: 110,
    consultants: 360,
    main_contractors: 300,
    enabling_contractors: 19,
    total: 789,
  };

  return (
    <LevelDistributionHeatMap
      companies={companiesRes.data ?? []}
      universe={universe}
    />
  );
}
