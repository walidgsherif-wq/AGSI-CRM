import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { LEVELS, type Level } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LevelChangeButton } from '@/components/domain/LevelChangeDialog';

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

const LEVEL_DESCRIPTION: Record<Level, string> = {
  L0: 'Not yet engaged',
  L1: 'Identified',
  L2: 'In conversation',
  L3: 'Active relationship',
  L4: 'MOU signed',
  L5: 'Strategic partnership',
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

  // Pending request counts so cards show a "Pending" badge
  const { data: pendingRows } = await supabase
    .from('level_change_requests')
    .select('company_id')
    .eq('status', 'pending');
  const pendingByCompany = new Map<string, number>();
  for (const r of (pendingRows ?? []) as Array<{ company_id: string }>) {
    pendingByCompany.set(r.company_id, (pendingByCompany.get(r.company_id) ?? 0) + 1);
  }

  const grouped: Record<Level, CardRow[]> = {
    L0: [], L1: [], L2: [], L3: [], L4: [], L5: [],
  };
  for (const c of all) grouped[c.current_level].push(c);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Pipeline</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Stakeholder progression L0 → L5.{' '}
          {user.role === 'admin'
            ? 'Click "Change level →" on any card; the ledger records who, when, evidence note.'
            : 'You can request progression on stakeholders you own. An admin reviews each request.'}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {LEVELS.map((level) => {
          const cards = grouped[level];
          return (
            <div key={level} className="flex min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LevelBadge level={level} />
                  <span className="text-xs text-agsi-darkGray">{cards.length}</span>
                </div>
              </div>
              <p className="mb-2 text-xs text-agsi-darkGray">{LEVEL_DESCRIPTION[level]}</p>
              <div className="space-y-2">
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-agsi-lightGray p-3 text-xs text-agsi-darkGray">
                    No companies at this level.
                  </p>
                ) : (
                  cards.map((c) => {
                    const pending = pendingByCompany.get(c.id) ?? 0;
                    return (
                      <div
                        key={c.id}
                        className="rounded-lg border border-agsi-lightGray bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/companies/${c.id}`}
                            className="text-sm font-medium text-agsi-navy hover:underline"
                          >
                            {c.canonical_name}
                          </Link>
                          {c.is_key_stakeholder && (
                            <Badge variant="gold" className="shrink-0">
                              Key
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          {COMPANY_TYPE_LABEL[c.company_type]}
                          {c.city && ` · ${c.city}`}
                        </p>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          Owner: {c.owner?.full_name ?? 'Unassigned'}
                        </p>
                        {pending > 0 && (
                          <Badge variant="amber" className="mt-2">
                            {pending} pending review
                          </Badge>
                        )}
                        <div className="mt-2">
                          <LevelChangeButton
                            companyId={c.id}
                            companyName={c.canonical_name}
                            currentLevel={c.current_level}
                            userRole={user.role}
                            isOwner={c.owner_id === user.id}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How the ledger works</CardTitle>
          <CardDescription>
            change_company_level() writes a level_history row with snapshots of owner +
            company type at the time, plus the fiscal year/quarter. Forward moves count
            toward Driver A/B/C scoring; backward moves are stored uncredited so the audit
            trail stays complete.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
