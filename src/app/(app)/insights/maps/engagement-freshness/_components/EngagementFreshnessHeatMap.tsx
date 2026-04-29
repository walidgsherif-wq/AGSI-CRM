'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { HeatMapExportButton } from '@/components/domain/HeatMapExportButton';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';

type CompanyType = (typeof COMPANY_TYPES)[number];

type Company = {
  id: string;
  canonical_name: string;
  company_type: CompanyType;
  current_level: Level;
  owner_id: string | null;
  has_active_projects: boolean;
};

type Engagement = {
  company_id: string;
  engagement_date: string;
};

type Bucket = 'hot' | 'warm' | 'cooling' | 'cold' | 'none';

const BUCKET_COLOR: Record<Bucket, string> = {
  hot: '#2E7D52',     // green
  warm: '#9CAF44',    // lime
  cooling: '#DD8E2A', // amber
  cold: '#C53030',    // red
  none: '#E8EDF4',    // lightGray (no engagement)
};

const BUCKET_LABEL: Record<Bucket, string> = {
  hot: 'Hot (≤14d)',
  warm: 'Warm (15–45d)',
  cooling: 'Cooling (46–90d)',
  cold: 'Cold (>90d)',
  none: 'No engagement in window',
};

function bucketForDays(daysAgo: number | null): Bucket {
  if (daysAgo === null) return 'cold';
  if (daysAgo <= 14) return 'hot';
  if (daysAgo <= 45) return 'warm';
  if (daysAgo <= 90) return 'cooling';
  return 'cold';
}

function dayDiff(iso: string, today: Date): number {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

export function EngagementFreshnessHeatMap({
  companies,
  engagements,
  weeksBack,
  currentUserId,
}: {
  companies: Company[];
  engagements: Engagement[];
  weeksBack: number;
  currentUserId: string;
}) {
  const [typeFilter, setTypeFilter] = useState<CompanyType | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<Level | 'all' | 'l3plus'>('all');
  const [myOnly, setMyOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'level' | 'most_neglected'>('level');

  const captureRef = useRef<HTMLDivElement>(null!);

  // Anchor "today" once per render so all bucket math is consistent.
  const today = useMemo(() => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), []);

  // Per-company engagement metadata.
  const engagementsByCompany = useMemo(() => {
    const map = new Map<string, number[]>(); // company_id → list of daysAgo
    for (const e of engagements) {
      const days = dayDiff(e.engagement_date, today);
      if (days < 0) continue;
      const list = map.get(e.company_id) ?? [];
      list.push(days);
      map.set(e.company_id, list);
    }
    return map;
  }, [engagements, today]);

  // Filtered + decorated companies.
  const decorated = useMemo(() => {
    return companies
      .filter((c) => {
        if (typeFilter !== 'all' && c.company_type !== typeFilter) return false;
        if (levelFilter === 'l3plus') {
          if (!['L3', 'L4', 'L5'].includes(c.current_level)) return false;
        } else if (levelFilter !== 'all' && c.current_level !== levelFilter) {
          return false;
        }
        if (myOnly && c.owner_id !== currentUserId) return false;
        return true;
      })
      .map((c) => {
        const allDays = engagementsByCompany.get(c.id) ?? [];
        const minDays = allDays.length > 0 ? Math.min(...allDays) : null;
        const lastBucket = bucketForDays(minDays);
        // Per-week bucket: we mark cells where any engagement fell in that week
        // and colour them by THAT engagement's bucket relative to today.
        const cells: Bucket[] = Array.from({ length: weeksBack }, () => 'none');
        for (const days of allDays) {
          if (days >= weeksBack * 7) continue;
          const idx = weeksBack - 1 - Math.floor(days / 7);
          if (idx < 0 || idx >= weeksBack) continue;
          const cellBucket = bucketForDays(days);
          // Keep the freshest bucket if multiple engagements in same week.
          if (rank(cellBucket) > rank(cells[idx])) {
            cells[idx] = cellBucket;
          }
        }
        return {
          ...c,
          minDays,
          lastBucket,
          cells,
          totalCount: allDays.length,
        };
      });
  }, [companies, engagementsByCompany, typeFilter, levelFilter, myOnly, currentUserId, weeksBack]);

  const sorted = useMemo(() => {
    const list = [...decorated];
    if (sortMode === 'most_neglected') {
      list.sort((a, b) => {
        // never-engaged first, then largest minDays
        const ad = a.minDays ?? Infinity;
        const bd = b.minDays ?? Infinity;
        if (bd !== ad) return bd - ad;
        return a.canonical_name.localeCompare(b.canonical_name);
      });
    } else {
      const order: Level[] = ['L5', 'L4', 'L3', 'L2', 'L1', 'L0'];
      list.sort((a, b) => {
        const lvl = order.indexOf(a.current_level) - order.indexOf(b.current_level);
        if (lvl !== 0) return lvl;
        return a.canonical_name.localeCompare(b.canonical_name);
      });
    }
    return list;
  }, [decorated, sortMode]);

  const coolingL3plus = useMemo(() => {
    return decorated
      .filter((c) => ['L3', 'L4', 'L5'].includes(c.current_level))
      .filter((c) => c.lastBucket === 'cooling' || c.lastBucket === 'cold')
      .sort((a, b) => (b.minDays ?? Infinity) - (a.minDays ?? Infinity))
      .slice(0, 25);
  }, [decorated]);

  const bucketCounts = useMemo(() => {
    const c: Record<Bucket, number> = { hot: 0, warm: 0, cooling: 0, cold: 0, none: 0 };
    for (const d of decorated) c[d.lastBucket] += 1;
    return c;
  }, [decorated]);

  // Week column labels — show every 4th week to keep the header readable.
  const weekLabels = useMemo(() => {
    return Array.from({ length: weeksBack }, (_, i) => {
      const weeksAgo = weeksBack - 1 - i;
      if (weeksAgo % 4 !== 0) return '';
      return weeksAgo === 0 ? 'now' : `−${weeksAgo}w`;
    });
  }, [weeksBack]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Engagement freshness</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Stakeholder × week matrix, last {weeksBack} weeks. Cells coloured by recency
            of the engagement that fell in that week.
          </p>
        </div>
        <HeatMapExportButton filename="agsi-engagement-freshness" targetRef={captureRef} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            Showing <strong>{decorated.length}</strong> of {companies.length} stakeholders.
            Bucket counts use each company&apos;s most recent engagement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-5">
            {(['hot', 'warm', 'cooling', 'cold', 'none'] as Bucket[]).map((b) => (
              <div
                key={b}
                className="rounded-lg border border-agsi-lightGray bg-white p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-5 rounded"
                    style={{ backgroundColor: BUCKET_COLOR[b] }}
                    aria-hidden
                  />
                  <span className="text-xs font-medium text-agsi-darkGray">
                    {BUCKET_LABEL[b]}
                  </span>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-agsi-navy">
                  {bucketCounts[b]}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Adjust the matrix scope.</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Type" value={typeFilter} onChange={(v) => setTypeFilter(v as CompanyType | 'all')}>
                <option value="all">All types</option>
                {COMPANY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPANY_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Select label="Level" value={levelFilter} onChange={(v) => setLevelFilter(v as Level | 'all' | 'l3plus')}>
                <option value="all">All levels</option>
                <option value="l3plus">L3+ only</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
              <Select label="Sort" value={sortMode} onChange={(v) => setSortMode(v as 'level' | 'most_neglected')}>
                <option value="level">By L-level (high → low)</option>
                <option value="most_neglected">Most neglected first</option>
              </Select>
              <label className="flex items-center gap-2 text-sm text-agsi-navy">
                <input
                  type="checkbox"
                  checked={myOnly}
                  onChange={(e) => setMyOnly(e.target.checked)}
                  className="rounded border-agsi-midGray"
                />
                My accounts only
              </label>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="p-2">
            <div ref={captureRef} className="overflow-x-auto bg-white p-3">
              {sorted.length === 0 ? (
                <p className="p-4 text-sm text-agsi-darkGray">No stakeholders match.</p>
              ) : (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-agsi-darkGray">
                        Stakeholder
                      </th>
                      <th className="px-1 py-1 text-left font-medium text-agsi-darkGray">
                        Lvl
                      </th>
                      {weekLabels.map((label, i) => (
                        <th
                          key={i}
                          className="px-0 py-1 text-center font-normal text-agsi-darkGray"
                          style={{ minWidth: 14 }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c) => (
                      <tr key={c.id}>
                        <td className="sticky left-0 z-10 max-w-[220px] truncate bg-white px-2 py-1">
                          <Link
                            href={`/companies/${c.id}`}
                            className="text-agsi-navy hover:underline"
                            title={c.canonical_name}
                          >
                            {c.canonical_name}
                          </Link>
                        </td>
                        <td className="px-1 py-1">
                          <LevelBadge level={c.current_level} />
                        </td>
                        {c.cells.map((b, i) => (
                          <td
                            key={i}
                            className="px-0 py-0.5"
                            title={
                              b === 'none'
                                ? 'No engagement'
                                : `${BUCKET_LABEL[b]} · week ${weeksBack - 1 - i}`
                            }
                          >
                            <span
                              className="block h-3"
                              style={{
                                backgroundColor: BUCKET_COLOR[b],
                                opacity: b === 'none' ? 0.4 : 1,
                              }}
                              aria-hidden
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cooling &amp; cold L3+ accounts</CardTitle>
            <CardDescription>High-value stakeholders with no recent touch.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {coolingL3plus.length === 0 ? (
              <p className="p-4 text-sm text-agsi-darkGray">
                Every L3+ account has been touched within the last 45 days.
              </p>
            ) : (
              <ul className="max-h-[460px] divide-y divide-agsi-lightGray overflow-y-auto">
                {coolingL3plus.map((c) => (
                  <li key={c.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/companies/${c.id}`}
                        className="truncate text-sm font-medium text-agsi-navy hover:underline"
                        title={c.canonical_name}
                      >
                        {c.canonical_name}
                      </Link>
                      <LevelBadge level={c.current_level} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[c.company_type]}
                      </span>
                      <Badge
                        variant={c.lastBucket === 'cold' ? 'red' : 'amber'}
                      >
                        {c.minDays === null ? 'Never (in window)' : `${c.minDays}d ago`}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function rank(b: Bucket): number {
  return { none: 0, cold: 1, cooling: 2, warm: 3, hot: 4 }[b];
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
