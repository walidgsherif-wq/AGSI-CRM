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

  // Freshness on unclaimed BNC records is noise — nobody logs
  // engagement on dossier rows. Scope to owned/claimed stakeholders;
  // the matrix then answers "of the work we've taken on, what's
  // gone cold". Paginated because Supabase silently caps at 1000.
  const PAGE_SIZE = 1000;
  const HARD_CAP = 20_000;
  const companies: CompanyRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
    const { data: batch } = await supabase
      .from('companies')
      .select(
        'id, canonical_name, company_type, current_level, owner_id, has_active_projects',
      )
      .eq('is_active', true)
      .is('merged_into_company_id', null)
      .not('owner_id', 'is', null)
      .order('canonical_name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<CompanyRow[]>();
    const rows = batch ?? [];
    companies.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const { data: engagementsRaw } = await supabase
    .from('engagements')
    .select('company_id, engagement_date')
    .gte('engagement_date', sinceIso)
    .returns<EngagementRow[]>();

  return (
    <EngagementFreshnessHeatMap
      companies={companies}
      engagements={engagementsRaw ?? []}
      weeksBack={WEEKS_BACK}
      currentUserId={user.id}
    />
  );
}
