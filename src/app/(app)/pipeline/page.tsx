import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Level } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { PipelineKanban, type CardData } from './_components/PipelineKanban';

export const dynamic = 'force-dynamic';

type CardRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  city: string | null;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  owner_id: string | null;
  owner: { full_name: string } | null;
};

/** Stakeholder-type filter buckets. Each maps to one company_type enum. */
const STAKEHOLDER_FILTERS = [
  { key: 'developer', label: 'Owner' },
  { key: 'design_consultant', label: 'Design Consultant' },
  { key: 'main_contractor', label: 'Contractor' },
  { key: 'authority', label: 'Authority' },
] as const;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { type?: string; owner?: string };
}) {
  const user = await requireRole(['admin', 'bd_head', 'bd_manager']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  let query = supabase
    .from('companies')
    .select(
      'id, canonical_name, company_type, current_level, city, is_key_stakeholder, has_active_projects, owner_id, owner:profiles!companies_owner_id_fkey(full_name)',
    )
    .eq('is_active', true)
    .order('canonical_name', { ascending: true })
    .limit(2000);

  if (searchParams.type) query = query.eq('company_type', searchParams.type);
  if (searchParams.owner) query = query.eq('owner_id', searchParams.owner);

  const { data, error } = await query.returns<CardRow[]>();
  const all = data ?? [];

  const { data: pendingRows } = await supabase
    .from('level_change_requests')
    .select('company_id')
    .eq('status', 'pending');
  const pendingByCompany = new Map<string, number>();
  for (const r of (pendingRows ?? []) as Array<{ company_id: string }>) {
    pendingByCompany.set(r.company_id, (pendingByCompany.get(r.company_id) ?? 0) + 1);
  }

  const cards: CardData[] = all.map((c) => ({
    id: c.id,
    canonical_name: c.canonical_name,
    company_type: c.company_type,
    current_level: c.current_level,
    city: c.city,
    is_key_stakeholder: c.is_key_stakeholder,
    has_active_projects: c.has_active_projects,
    owner_id: c.owner_id,
    owner_full_name: c.owner?.full_name ?? null,
    pending_count: pendingByCompany.get(c.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Pipeline</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Stakeholder progression L0 → L5. Drag a card to an adjacent column to{' '}
          {user.role === 'admin' ? 'change' : 'request'} a level change, or use the link on
          each card. Single-step only — to move multiple levels, do each step separately.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-agsi-darkGray">
          Stakeholder type
        </span>
        <Link
          href="/pipeline"
          className={
            !searchParams.type
              ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
              : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
          }
        >
          All
        </Link>
        {STAKEHOLDER_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/pipeline?type=${f.key}`}
            className={
              searchParams.type === f.key
                ? 'rounded border border-agsi-navy bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                : 'rounded border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-rag-red">
            Failed to load: {error.message}
          </CardContent>
        </Card>
      )}

      <PipelineKanban cards={cards} userRole={user.role} userId={user.id} />

      <Card>
        <CardHeader>
          <CardTitle>How the ledger works</CardTitle>
          <CardDescription>
            change_company_level() writes a level_history row with snapshots of owner +
            company type at the time, plus the fiscal year/quarter. Forward moves count toward
            Driver A/B/C scoring; backward moves are stored uncredited so the audit trail
            stays complete. Single-step rule: each move requires its own evidence — no
            skipping levels.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
