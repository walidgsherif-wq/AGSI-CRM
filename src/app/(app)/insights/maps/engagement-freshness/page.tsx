import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { EngagementFreshnessHeatMap } from './_components/EngagementFreshnessHeatMap';
import type { Level } from '@/types/domain';
import type { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

type CompanyRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  owner_id: string | null;
  has_active_projects: boolean;
};

type EngagementRow = {
  company_id: string;
  engagement_date: string;
};

const WEEKS_BACK = 26;

export default async function EngagementFreshnessPage() {
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const sinceIso = new Date(Date.now() - WEEKS_BACK * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [companiesRes, engagementsRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, canonical_name, company_type, current_level, owner_id, has_active_projects')
      .eq('is_active', true)
      .eq('is_in_kpi_universe', true)
      .returns<CompanyRow[]>(),
    supabase
      .from('engagements')
      .select('company_id, engagement_date')
      .gte('engagement_date', sinceIso)
      .returns<EngagementRow[]>(),
  ]);

  return (
    <EngagementFreshnessHeatMap
      companies={companiesRes.data ?? []}
      engagements={engagementsRes.data ?? []}
      weeksBack={WEEKS_BACK}
      currentUserId={user.id}
    />
  );
}
