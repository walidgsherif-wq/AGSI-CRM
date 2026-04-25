import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { Button } from '@/components/ui/button';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';

export const dynamic = 'force-dynamic';

type CompanyRow = {
  id: string;
  canonical_name: string;
  company_type: (typeof COMPANY_TYPES)[number];
  city: string | null;
  current_level: Level;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  owner_id: string | null;
  owner: { full_name: string } | null;
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { type?: string; level?: string; q?: string; owner?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  let query = supabase
    .from('companies')
    .select(
      'id, canonical_name, company_type, city, current_level, is_key_stakeholder, has_active_projects, owner_id, owner:profiles!companies_owner_id_fkey(full_name)',
    )
    .eq('is_active', true)
    .order('canonical_name', { ascending: true });

  if (searchParams.type && (COMPANY_TYPES as readonly string[]).includes(searchParams.type)) {
    query = query.eq('company_type', searchParams.type);
  }
  if (searchParams.level && (LEVELS as readonly string[]).includes(searchParams.level)) {
    query = query.eq('current_level', searchParams.level);
  }
  if (searchParams.owner) {
    query = query.eq('owner_id', searchParams.owner);
  }
  if (searchParams.q) {
    query = query.ilike('canonical_name', `%${searchParams.q}%`);
  }

  const { data, error } = await query.returns<CompanyRow[]>();

  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Companies</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Canonical stakeholder master. {data?.length ?? 0} active.
          </p>
        </div>
        {canCreate && (
          <Link href="/companies/new">
            <Button>New company</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Narrow by type, level, owner, or name.</CardDescription>
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
              <label className="block text-xs font-medium text-agsi-darkGray">Type</label>
              <select
                name="type"
                defaultValue={searchParams.type ?? ''}
                className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
              >
                <option value="">All</option>
                {COMPANY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPANY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">Level</label>
              <select
                name="level"
                defaultValue={searchParams.level ?? ''}
                className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
              >
                <option value="">All</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
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
              No companies match these filters.{' '}
              {canCreate && (
                <Link href="/companies/new" className="text-agsi-accent hover:underline">
                  Create the first one.
                </Link>
              )}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Level</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/companies/${c.id}`} className="text-agsi-navy hover:underline">
                        {c.canonical_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">
                      {COMPANY_TYPE_LABEL[c.company_type]}
                    </td>
                    <td className="px-4 py-3">
                      <LevelBadge level={c.current_level} />
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">{c.city ?? '—'}</td>
                    <td className="px-4 py-3 text-agsi-darkGray">
                      {c.owner?.full_name ?? <span className="italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
                        {c.has_active_projects && <Badge variant="green">Active projects</Badge>}
                      </div>
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
