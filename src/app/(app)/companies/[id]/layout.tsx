import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { LevelChangeButton } from '@/components/domain/LevelChangeDialog';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { CompanyTabs } from './_components/CompanyTabs';

export const dynamic = 'force-dynamic';

type CompanyHeaderRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  city: string | null;
  current_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  source: string;
  owner_id: string | null;
};

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, canonical_name, company_type, city, current_level, is_key_stakeholder, has_active_projects, source, owner_id',
    )
    .eq('id', params.id)
    .single<CompanyHeaderRow>();

  if (!company) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/companies" className="text-xs text-agsi-darkGray hover:underline">
            ← Companies
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-agsi-navy">{company.canonical_name}</h1>
            <LevelBadge level={company.current_level} />
            {company.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
            {company.has_active_projects && <Badge variant="green">Active projects</Badge>}
          </div>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {COMPANY_TYPE_LABEL[company.company_type]} · {company.city ?? 'No city'} · Source:{' '}
            {company.source}
          </p>
        </div>
        <LevelChangeButton
          companyId={company.id}
          companyName={company.canonical_name}
          currentLevel={company.current_level}
          userRole={user.role}
          isOwner={company.owner_id === user.id}
          variant="button"
        />
      </div>

      <CompanyTabs companyId={company.id} />

      {children}
    </div>
  );
}
