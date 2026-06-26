'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { DataTable } from '@/components/ui/data-table';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import type { Level } from '@/types/domain';

// Mirrors FX-024: the only sort axes the server understands.
type SortKey = 'steel' | 'value' | 'count' | 'recency' | 'level';

export type StatsRow = {
  company_id: string;
  canonical_name: string;
  level: Level;
  owner_id: string | null;
  project_count: number;
  project_value_involved: number;
  est_steel_value: number;
  days_since_last_contact: number | null;
  engagement_bucket: 'hot' | 'warm' | 'cooling' | 'cold' | null;
};

export type CompanyAttrs = {
  id: string;
  company_type: (typeof COMPANY_TYPES)[number];
  city: string | null;
  is_key_stakeholder: boolean;
  has_active_projects: boolean;
  parent_company_id: string | null;
  parent: { canonical_name: string } | { canonical_name: string }[] | null;
  owner: { full_name: string } | null;
};

export type CompaniesRow = { stats: StatsRow; attrs: CompanyAttrs };

const BUCKET_BADGE: Record<NonNullable<StatsRow['engagement_bucket']>, 'green' | 'blue' | 'amber' | 'red'> = {
  hot: 'green',
  warm: 'blue',
  cooling: 'amber',
  cold: 'red',
};

const aedFmt = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Maps DataTable column ids → FX-024 sort keys. Columns without an
// entry are non-sortable (no server-side ORDER BY equivalent).
const COLUMN_TO_SORT_KEY: Partial<Record<string, SortKey>> = {
  level: 'level',
  projects: 'count',
  value: 'value',
  steel: 'steel',
  engagement: 'recency',
};
const SORT_KEY_TO_COLUMN: Record<SortKey, string> = {
  level: 'level',
  count: 'projects',
  value: 'value',
  steel: 'steel',
  recency: 'engagement',
};

const columns: ColumnDef<CompaniesRow, unknown>[] = [
  {
    id: 'company',
    header: 'Company',
    enableSorting: false,
    cell: ({ row }) => {
      const { stats: s, attrs } = row.original;
      const parent = Array.isArray(attrs.parent)
        ? (attrs.parent[0] ?? null)
        : attrs.parent;
      return (
        <div>
          <Link
            href={`/companies/${s.company_id}` as Route}
            className="font-medium text-agsi-navy hover:underline"
          >
            {s.canonical_name}
          </Link>
          {parent && attrs.parent_company_id && (
            <Link
              href={`/companies/${attrs.parent_company_id}` as Route}
              className="ml-2 text-xs text-agsi-darkGray hover:underline"
            >
              part of {parent.canonical_name}
            </Link>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {attrs.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
            {attrs.has_active_projects && (
              <Badge variant="green">Active projects</Badge>
            )}
          </div>
        </div>
      );
    },
  },
  {
    id: 'type',
    header: 'Type',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-agsi-darkGray">
        {COMPANY_TYPE_LABEL[row.original.attrs.company_type]}
      </span>
    ),
  },
  {
    id: 'level',
    header: 'Level',
    enableSorting: true,
    cell: ({ row }) => <LevelBadge level={row.original.stats.level} />,
  },
  {
    id: 'owner',
    header: 'Owner',
    enableSorting: false,
    cell: ({ row }) => {
      const o = row.original.attrs.owner;
      return (
        <div className="flex items-center gap-2">
          <Avatar
            name={o?.full_name ?? null}
            size="xs"
            title={`Owner: ${o?.full_name ?? 'Unassigned'}`}
          />
          <span className="text-agsi-darkGray">
            {o?.full_name ?? <span className="italic">Unassigned</span>}
          </span>
        </div>
      );
    },
  },
  {
    id: 'projects',
    header: '# projects',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-agsi-navy">
        {Number(row.original.stats.project_count).toLocaleString()}
      </span>
    ),
  },
  {
    id: 'value',
    header: 'Project value involved',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-agsi-navy">
        {aedFmt.format(Number(row.original.stats.project_value_involved))}
      </span>
    ),
  },
  {
    id: 'steel',
    header: 'Est. steel value',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-agsi-navy">
        {aedFmt.format(Number(row.original.stats.est_steel_value))}
      </span>
    ),
  },
  {
    id: 'engagement',
    header: 'Engagement',
    enableSorting: true,
    cell: ({ row }) => {
      const s = row.original.stats;
      if (!s.engagement_bucket) {
        return <span className="text-xs italic text-agsi-darkGray">—</span>;
      }
      return (
        <div className="flex flex-col gap-0.5">
          <Badge variant={BUCKET_BADGE[s.engagement_bucket]}>{s.engagement_bucket}</Badge>
          <span className="text-xs2 text-agsi-darkGray">
            {s.days_since_last_contact === null
              ? 'never'
              : `${s.days_since_last_contact}d since`}
          </span>
        </div>
      );
    },
  },
];

export interface CompaniesTableProps {
  rows: CompaniesRow[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  /** Full URL search-param record so we preserve filters on sort clicks. */
  query: Record<string, string | undefined>;
}

export function CompaniesTable({
  rows,
  sortKey,
  sortDir,
  query,
}: CompaniesTableProps) {
  const router = useRouter();

  const sort: SortingState = [
    { id: SORT_KEY_TO_COLUMN[sortKey], desc: sortDir === 'desc' },
  ];

  function onSortChange(next: SortingState) {
    const first = next[0];
    if (!first) return; // shouldn't happen with TanStack toggling
    const newKey = COLUMN_TO_SORT_KEY[first.id];
    if (!newKey) return; // ignore non-sortable columns
    const newDir: 'asc' | 'desc' = first.desc ? 'desc' : 'asc';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v && k !== 'sort' && k !== 'dir') params.set(k, v);
    }
    if (newKey !== 'steel' || newDir !== 'desc') {
      // Only emit sort/dir when they deviate from the default — keeps
      // shareable URLs tidy.
      params.set('sort', newKey);
      params.set('dir', newDir);
    }
    const qs = params.toString();
    router.push((qs ? `/companies?${qs}` : '/companies') as Route);
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      sort={sort}
      onSortChange={onSortChange}
      manualSorting
      minWidth="1000px"
      ariaLabel="Companies"
      empty={{
        title: 'No companies match these filters',
        description: 'Adjust the filters above or clear them to see the full list.',
      }}
    />
  );
}
