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
import { HeatMapExportButton } from '@/components/domain/HeatMapExportButton';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';

type CompanyType = (typeof COMPANY_TYPES)[number];

type Company = {
  id: string;
  canonical_name: string;
  company_type: CompanyType;
  current_level: Level;
  is_key_stakeholder: boolean | null;
  has_active_projects: boolean;
};

type UniverseSizes = {
  developers: number;
  consultants: number;
  main_contractors: number;
  enabling_contractors: number;
  total: number;
};

// L-level palette from §15.
const LEVEL_BG: Record<Level, string> = {
  L0: '#C5CDD8',
  L1: '#2B6CB0',
  L2: '#1F3C6E',
  L3: '#2E7D52',
  L4: '#6B4F9E',
  L5: '#D4AF37',
};

const LEVEL_COUNT: Record<Level, number> = {
  L0: 0, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0,
};

export function LevelDistributionHeatMap({
  companies,
  universe,
}: {
  companies: Company[];
  universe: UniverseSizes;
}) {
  const [typeFilter, setTypeFilter] = useState<CompanyType | 'all'>('all');
  const [highlight, setHighlight] = useState<'all' | 'l3plus' | 'key'>('all');

  const captureRef = useRef<HTMLDivElement>(null!);

  const filtered = useMemo(() => {
    return companies.filter(
      (c) => typeFilter === 'all' || c.company_type === typeFilter,
    );
  }, [companies, typeFilter]);

  const counts = useMemo(() => {
    const c = { ...LEVEL_COUNT };
    for (const x of filtered) c[x.current_level] += 1;
    return c;
  }, [filtered]);

  const universeForFilter = useMemo(() => {
    switch (typeFilter) {
      case 'developer':
        return universe.developers;
      case 'design_consultant':
      case 'mep_consultant':
        return universe.consultants;
      case 'main_contractor':
      case 'mep_contractor':
        return universe.main_contractors;
      default:
        return universe.total;
    }
  }, [typeFilter, universe]);

  const sorted = useMemo(() => {
    const order: Level[] = ['L5', 'L4', 'L3', 'L2', 'L1', 'L0'];
    return [...filtered].sort((a, b) => {
      const lvl = order.indexOf(a.current_level) - order.indexOf(b.current_level);
      if (lvl !== 0) return lvl;
      return a.canonical_name.localeCompare(b.canonical_name);
    });
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Level distribution heat map</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            One tile per stakeholder in the AGSI universe ({universeForFilter}).
            Tile colour = current L-level.
          </p>
        </div>
        <HeatMapExportButton
          filename="agsi-level-distribution"
          targetRef={captureRef}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Universe summary</CardTitle>
          <CardDescription>
            Block A (§3.16) — stakeholder count at each L-level vs the
            {typeFilter === 'all' ? ' 789-stakeholder' : ' filtered'} universe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {LEVELS.map((lvl) => {
              const n = counts[lvl];
              const pct = universeForFilter > 0 ? (n / universeForFilter) * 100 : 0;
              return (
                <div
                  key={lvl}
                  className="rounded-lg border border-agsi-lightGray bg-white p-3"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="inline-flex h-5 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: LEVEL_BG[lvl] }}
                    >
                      {lvl}
                    </span>
                    <span className="text-2xl font-semibold tabular-nums text-agsi-navy">
                      {n}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-agsi-darkGray">
                    {pct.toFixed(1)}% of universe
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Showing <strong>{filtered.length}</strong> stakeholders. Click a tile to
                open the company.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <Select label="Type" value={typeFilter} onChange={(v) => setTypeFilter(v as CompanyType | 'all')}>
                <option value="all">All types</option>
                {COMPANY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPANY_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Select
                label="Highlight"
                value={highlight}
                onChange={(v) => setHighlight(v as 'all' | 'l3plus' | 'key')}
              >
                <option value="all">No highlight</option>
                <option value="l3plus">Highlight L3+</option>
                <option value="key">Highlight key stakeholders</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={captureRef} className="bg-white p-2">
            {sorted.length === 0 ? (
              <p className="p-4 text-sm text-agsi-darkGray">No stakeholders match.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5">
                {sorted.map((c) => (
                  <Tile key={c.id} company={c} highlight={highlight} />
                ))}
              </div>
            )}
            <Legend />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  company,
  highlight,
}: {
  company: Company;
  highlight: 'all' | 'l3plus' | 'key';
}) {
  const isHighlighted =
    highlight === 'all' ||
    (highlight === 'l3plus' && ['L3', 'L4', 'L5'].includes(company.current_level)) ||
    (highlight === 'key' && company.is_key_stakeholder === true);

  return (
    <Link
      href={`/companies/${company.id}`}
      className="group block rounded-md p-2 text-left transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-agsi-accent"
      style={{
        backgroundColor: LEVEL_BG[company.current_level],
        opacity: isHighlighted ? 1 : 0.18,
      }}
      title={`${company.canonical_name} · ${COMPANY_TYPE_LABEL[company.company_type]} · ${company.current_level}`}
    >
      <p
        className="truncate text-[11px] font-semibold leading-tight text-white"
        style={{ textShadow: '0 1px 1px rgba(0,0,0,0.25)' }}
      >
        {company.canonical_name}
      </p>
      <p className="text-[10px] text-white/85">
        {COMPANY_TYPE_LABEL[company.company_type]}
        {company.is_key_stakeholder ? ' · key' : ''}
      </p>
    </Link>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-agsi-darkGray">
      <span>Levels:</span>
      {LEVELS.map((lvl) => (
        <span key={lvl} className="flex items-center gap-1">
          <span
            className="h-2.5 w-4 rounded"
            style={{ backgroundColor: LEVEL_BG[lvl] }}
            aria-hidden
          />
          {lvl}
        </span>
      ))}
    </div>
  );
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
