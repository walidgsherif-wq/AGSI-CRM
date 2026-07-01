import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { COMPANY_TYPE_LABEL, COMPANY_TYPES } from '@/lib/zod/company';

type CompanyType = (typeof COMPANY_TYPES)[number];
import type { Level } from '@/types/domain';
import { DuplicatePairRow } from './_components/DuplicatePairRow';

export const dynamic = 'force-dynamic';

type CandidateRow = {
  a_id: string;
  a_name: string;
  b_id: string;
  b_name: string;
  company_type: CompanyType;
  similarity: number;
};

export type CompanySnapshot = {
  id: string;
  canonical_name: string;
  company_type: CompanyType;
  current_level: Level;
  owner_id: string | null;
  owner: { full_name: string } | { full_name: string }[] | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  location_id: string | null;
  country: string | null;
  is_key_stakeholder: boolean;
  parent_company_id: string | null;
  is_active: boolean;
};

export type PairChildCounts = {
  companyId: string;
  projects: number;
  engagements: number;
  contacts: number;
  levelHistory: number;
};

export default async function DuplicatesPage() {
  // Admin/bd_head can see the whole finder; bd_manager sees the page
  // but the merge action is gated per-pair by the ownership rule.
  await requireRole(['admin', 'bd_head', 'bd_manager']);
  const viewer = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: candidatesRaw } = await supabase.rpc('find_duplicate_candidates', {
    p_threshold: 0.55,
    p_limit: 100,
  });
  const candidates = (candidatesRaw ?? []) as CandidateRow[];

  // Batch-fetch snapshots + child counts for every id in play so the
  // conflict-resolution dialogs can render instantly without a round-
  // trip per pair.
  const ids = Array.from(
    new Set(candidates.flatMap((c) => [c.a_id, c.b_id])),
  );
  const snapshots = new Map<string, CompanySnapshot>();
  const counts = new Map<string, PairChildCounts>();
  if (ids.length > 0) {
    const { data: snapsRaw } = await supabase
      .from('companies')
      .select(
        'id, canonical_name, company_type, current_level, owner_id, owner:profiles!companies_owner_id_fkey(full_name), phone, email, website, location_id, country, is_key_stakeholder, parent_company_id, is_active',
      )
      .in('id', ids)
      .returns<CompanySnapshot[]>();
    for (const s of snapsRaw ?? []) snapshots.set(s.id, s);

    // Child-count preview: run the four aggregates in parallel and
    // fold into counts. head=true + count='exact' keeps payload small.
    const [proj, eng, con, lvl] = await Promise.all([
      supabase
        .from('project_companies')
        .select('company_id', { count: 'exact' })
        .in('company_id', ids),
      supabase
        .from('engagements')
        .select('company_id', { count: 'exact' })
        .in('company_id', ids),
      supabase
        .from('contacts')
        .select('company_id', { count: 'exact' })
        .in('company_id', ids)
        .is('deleted_at', null),
      supabase
        .from('level_history')
        .select('company_id', { count: 'exact' })
        .in('company_id', ids),
    ]);
    // Tally per company_id from the returned rows (fetch all so we can
    // group; ids.length is bounded by candidate count * 2).
    const tally = (
      arr: Array<{ company_id: string }> | null | undefined,
      key: keyof PairChildCounts,
    ) => {
      for (const r of arr ?? []) {
        const c = counts.get(r.company_id) ?? {
          companyId: r.company_id,
          projects: 0,
          engagements: 0,
          contacts: 0,
          levelHistory: 0,
        };
        (c as unknown as Record<string, number>)[key] =
          ((c as unknown as Record<string, number>)[key] ?? 0) + 1;
        counts.set(r.company_id, c);
      }
    };
    tally(proj.data as Array<{ company_id: string }> | null, 'projects');
    tally(eng.data as Array<{ company_id: string }> | null, 'engagements');
    tally(con.data as Array<{ company_id: string }> | null, 'contacts');
    tally(lvl.data as Array<{ company_id: string }> | null, 'levelHistory');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">
          Possible duplicates
        </h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Same-type companies with similar canonical names. Merging collapses
          the pair into one surviving record and re-points every
          project/engagement/contact/level-history row. Distinct from a
          holding-structure grouping request &mdash; use merge only for
          duplicates of the same entity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{candidates.length} candidate pair{candidates.length === 1 ? '' : 's'}</CardTitle>
          <CardDescription>
            Sorted by name similarity (top {candidates.length} of &leq;100). Threshold 0.55.
            Marking a pair distinct removes it from future results.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {candidates.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No candidates &mdash; nothing above the similarity threshold that
              hasn&rsquo;t already been marked distinct.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {candidates.map((c) => {
                const a = snapshots.get(c.a_id);
                const b = snapshots.get(c.b_id);
                if (!a || !b) return null;
                return (
                  <li key={`${c.a_id}:${c.b_id}`} className="px-4 py-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="blue">
                        {COMPANY_TYPE_LABEL[c.company_type]}
                      </Badge>
                      <Badge variant="amber">
                        similarity {(c.similarity * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    <DuplicatePairRow
                      pair={{ aId: c.a_id, bId: c.b_id }}
                      left={a}
                      right={b}
                      leftCounts={counts.get(c.a_id) ?? {
                        companyId: c.a_id,
                        projects: 0,
                        engagements: 0,
                        contacts: 0,
                        levelHistory: 0,
                      }}
                      rightCounts={counts.get(c.b_id) ?? {
                        companyId: c.b_id,
                        projects: 0,
                        engagements: 0,
                        contacts: 0,
                        levelHistory: 0,
                      }}
                      viewerId={viewer.id}
                      viewerRole={viewer.role}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
