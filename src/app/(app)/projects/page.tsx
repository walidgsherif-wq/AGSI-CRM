import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABEL,
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABEL,
} from '@/lib/zod/project';

export const dynamic = 'force-dynamic';

type ProjectRow = {
  id: string;
  name: string;
  stage: (typeof PROJECT_STAGES)[number];
  city: string | null;
  sector: string | null;
  value_aed: number | null;
  agsi_priority: (typeof PROJECT_PRIORITIES)[number] | null;
  is_dormant: boolean;
};

const AED = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { stage?: string; priority?: string; q?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  let query = supabase
    .from('projects')
    .select('id, name, stage, city, sector, value_aed, agsi_priority, is_dormant')
    .eq('is_dormant', false)
    .order('name', { ascending: true });

  if (searchParams.stage && (PROJECT_STAGES as readonly string[]).includes(searchParams.stage)) {
    query = query.eq('stage', searchParams.stage);
  }
  if (
    searchParams.priority &&
    (PROJECT_PRIORITIES as readonly string[]).includes(searchParams.priority)
  ) {
    query = query.eq('agsi_priority', searchParams.priority);
  }
  if (searchParams.q) {
    query = query.ilike('name', `%${searchParams.q}%`);
  }

  const { data, error } = await query.returns<ProjectRow[]>();
  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Projects</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            BNC-synced projects + AGSI internal priority. {data?.length ?? 0} live.
          </p>
        </div>
        {canCreate && (
          <Link href="/projects/new">
            <Button>New project</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Narrow by stage, priority, or name.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Search</label>
              <input
                name="q"
                defaultValue={searchParams.q ?? ''}
                placeholder="Name…"
                className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Stage</label>
              <select
                name="stage"
                defaultValue={searchParams.stage ?? ''}
                className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
              >
                <option value="">All</option>
                {PROJECT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Priority</label>
              <select
                name="priority"
                defaultValue={searchParams.priority ?? ''}
                className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
              >
                <option value="">All</option>
                {PROJECT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PROJECT_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Apply
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-rag-red">Failed to load: {error.message}</p>
          ) : !data || data.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No projects match these filters.{' '}
              {canCreate && (
                <Link href="/projects/new" className="text-agsi-accent hover:underline">
                  Create the first one.
                </Link>
              )}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Sector</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/projects/${p.id}`} className="text-agsi-navy hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">{PROJECT_STAGE_LABEL[p.stage]}</td>
                    <td className="px-4 py-3 text-agsi-darkGray">{p.city ?? '—'}</td>
                    <td className="px-4 py-3 text-agsi-darkGray">{p.sector ?? '—'}</td>
                    <td className="px-4 py-3 text-agsi-darkGray tabular">
                      {p.value_aed ? AED.format(p.value_aed) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {p.agsi_priority ? (
                        <Badge
                          variant={
                            p.agsi_priority === 'tier_1'
                              ? 'purple'
                              : p.agsi_priority === 'tier_2'
                                ? 'blue'
                                : p.agsi_priority === 'tier_3'
                                  ? 'neutral'
                                  : 'amber'
                          }
                        >
                          {PROJECT_PRIORITY_LABEL[p.agsi_priority]}
                        </Badge>
                      ) : (
                        <span className="text-agsi-darkGray">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
