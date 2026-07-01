import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireFeature } from '@/lib/auth/features';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Level } from '@/types/domain';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { PipelineKanban, type CardData } from './_components/PipelineKanban';
import { OwnerFilter } from './_components/OwnerFilter';
import { fetchOwnerOptions } from '@/lib/auth/owner-options';
import { getCrmSetupMode } from '@/lib/setup-mode';

export const dynamic = 'force-dynamic';

type CardRow = {
  id: string;
  canonical_name: string;
  company_type: keyof typeof COMPANY_TYPE_LABEL;
  current_level: Level;
  city: string | null;
  location_id: string | null;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  owner_id: string | null;
  owner: { full_name: string } | null;
};

function LegendChip({
  color,
  label,
}: {
  color: 'green' | 'blue' | 'amber' | 'red';
  label: string;
}) {
  const swatch = {
    green: 'bg-rag-green',
    blue: 'bg-agsi-accent',
    amber: 'bg-rag-amber',
    red: 'bg-rag-red',
  }[color];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden />
      {label}
    </span>
  );
}

/** Stakeholder-type filter buckets. Labels sourced from
 * COMPANY_TYPE_LABEL so the chip text can never drift from the
 * canonical name shown elsewhere (companies list, dashboard, reports). */
const STAKEHOLDER_FILTERS = [
  { key: 'developer', label: COMPANY_TYPE_LABEL.developer },
  { key: 'design_consultant', label: COMPANY_TYPE_LABEL.design_consultant },
  { key: 'main_contractor', label: COMPANY_TYPE_LABEL.main_contractor },
  { key: 'authority', label: COMPANY_TYPE_LABEL.authority },
] as const;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { type?: string; owner?: string };
}) {
  const user = await requireFeature('pipeline');
  const crmSetupMode = await getCrmSetupMode();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  // Owner filter is a view convenience — every authenticated role can
  // SELECT all companies (companies_select_all in 0022), so this is
  // not an RLS scope. Leadership/admin/bd_head/bd_manager all get it.
  const canFilterByOwner =
    user.role === 'admin' ||
    user.role === 'bd_head' ||
    user.role === 'bd_manager' ||
    user.role === 'leadership';
  const ownerOptions = canFilterByOwner ? await fetchOwnerOptions(supabase) : [];

  // Paginated fetch: a single .limit(2000) silently truncated the
  // alphabetic tail under the "All" filter, hiding whole levels
  // (notably L5 — rare partnerships that happened to land past the
  // cap). Chips appeared to work only because each company_type
  // subset stayed under 2000. We page through PostgREST's per-
  // request window (1000 rows) until exhausted so every active
  // company renders. HARD_CAP is a safety ceiling, well above any
  // realistic active-company count.
  const PAGE_SIZE = 1000;
  const HARD_CAP = 20_000;
  const all: CardRow[] = [];
  let error: { message: string } | null = null;
  for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
    let query = supabase
      .from('companies')
      .select(
        'id, canonical_name, company_type, current_level, city, location_id, is_key_stakeholder, has_active_projects, owner_id, owner:profiles!companies_owner_id_fkey(full_name)',
      )
      .eq('is_active', true)
      .is('merged_into_company_id', null)
      .order('canonical_name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (searchParams.type) query = query.eq('company_type', searchParams.type);
    if (searchParams.owner === 'unassigned') {
      query = query.is('owner_id', null);
    } else if (searchParams.owner) {
      query = query.eq('owner_id', searchParams.owner);
    }
    const { data: batch, error: batchErr } = await query.returns<CardRow[]>();
    if (batchErr) {
      error = batchErr;
      break;
    }
    const rows = batch ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // One pending request per card. Schema allows multiple but in
  // practice an approver acts on the latest before another is raised;
  // we surface the most recent for the actionable badge.
  type PendingRow = {
    id: string;
    company_id: string;
    from_level: Level;
    to_level: Level;
    created_at: string;
  };
  const { data: pendingRows } = await supabase
    .from('level_change_requests')
    .select('id, company_id, from_level, to_level, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .returns<PendingRow[]>();
  const pendingByCompany = new Map<
    string,
    { request_id: string; from_level: Level; to_level: Level }
  >();
  for (const r of pendingRows ?? []) {
    if (pendingByCompany.has(r.company_id)) continue;
    pendingByCompany.set(r.company_id, {
      request_id: r.id,
      from_level: r.from_level,
      to_level: r.to_level,
    });
  }

  type ScoreRow = {
    company_id: string;
    bucket: 'hot' | 'warm' | 'cooling' | 'cold';
    days_since_last_engagement: number | null;
  };
  // Chunk the .in() filter so each URL stays well under PostgREST's
  // length cap. A single .in(...2000 uuids) request balloons to ~76 KB
  // and is silently dropped (every card stuck at score 0 / cold), and
  // an unfiltered fetch hits Supabase's default max-rows cap when total
  // company count is large — half the cards came back missing. 100
  // uuids per chunk keeps each URL ~4 KB; ~20 parallel requests for a
  // 2000-card page complete well inside the existing request budget.
  const ids = all.map((c) => c.id);
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('company_engagement_score')
        .select('company_id, bucket, days_since_last_engagement')
        .in('company_id', chunk)
        .returns<ScoreRow[]>(),
    ),
  );
  const scoreByCompany = new Map<string, ScoreRow>();
  for (const res of chunkResults) {
    for (const r of res.data ?? []) scoreByCompany.set(r.company_id, r);
  }

  // Companies with ≥1 live contact whose email is set. L2+ progression
  // requires a contactable stakeholder, so a contact without an email
  // doesn't satisfy the gate. Chunked .in() mirrors the engagement-
  // score pattern above to dodge PostgREST's URL length cap.
  type ContactRow = { company_id: string };
  const contactChunks = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('contacts')
        .select('company_id')
        .is('deleted_at', null)
        .not('email', 'is', null)
        .neq('email', '')
        .in('company_id', chunk)
        .returns<ContactRow[]>(),
    ),
  );
  const companiesWithContact = new Set<string>();
  for (const res of contactChunks) {
    for (const r of res.data ?? []) companiesWithContact.add(r.company_id);
  }

  const cards: CardData[] = all.map((c) => {
    const s = scoreByCompany.get(c.id);
    const hasContact = companiesWithContact.has(c.id);
    const hasLocation = c.location_id !== null;
    const isOwned = c.owner_id !== null;
    return {
      id: c.id,
      canonical_name: c.canonical_name,
      company_type: c.company_type,
      current_level: c.current_level,
      city: c.city,
      is_key_stakeholder: c.is_key_stakeholder,
      has_active_projects: c.has_active_projects,
      owner_id: c.owner_id,
      owner_full_name: c.owner?.full_name ?? null,
      pending: pendingByCompany.get(c.id) ?? null,
      engagement_bucket: s?.bucket ?? 'cold',
      engagement_days_since: s?.days_since_last_engagement ?? null,
      needs_details: isOwned && (!hasLocation || !hasContact),
      is_progress_ready: hasLocation && hasContact,
    };
  });

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
        {canFilterByOwner && (
          <div className="ml-auto">
            <OwnerFilter current={searchParams.owner ?? ''} options={ownerOptions} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-xs text-agsi-darkGray">
        <span className="font-medium text-agsi-navy">Engagement glow</span>
        <LegendChip color="green" label="Hot · ≤30d" />
        <LegendChip color="blue" label="Warm · ≤60d" />
        <LegendChip color="amber" label="Cooling · ≤90d" />
        <LegendChip color="red" label="Cold · 90d+" />
        <span className="ml-auto text-xs2 text-agsi-midGray">
          Log a call, meeting, or Cc client emails to keep cards green.
        </span>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-rag-red">
            Failed to load: {error.message}
          </CardContent>
        </Card>
      )}

      <PipelineKanban
        cards={cards}
        userRole={user.role}
        userId={user.id}
        crmSetupMode={crmSetupMode}
      />

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
