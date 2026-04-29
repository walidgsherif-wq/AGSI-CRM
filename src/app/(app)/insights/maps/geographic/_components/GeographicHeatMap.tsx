'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HeatMapExportButton } from '@/components/domain/HeatMapExportButton';
import {
  COMPANY_TYPE_LABEL,
  COMPANY_TYPES,
} from '@/lib/zod/company';
import { LEVELS, type Level } from '@/types/domain';

type CompanyType = (typeof COMPANY_TYPES)[number];

type Company = {
  id: string;
  canonical_name: string;
  city: string | null;
  company_type: CompanyType;
  current_level: Level;
  has_active_projects: boolean;
};

type City = {
  city_name: string;
  emirate: string;
  latitude: number;
  longitude: number;
};

type ActiveFilter = 'all' | 'active' | 'inactive';

// SVG projection. Bounding box for UAE-ish view; tweaked so all seeded
// city coords land comfortably inside the 800×480 canvas with margin.
const SVG_W = 800;
const SVG_H = 480;
const LON_MIN = 51.5;
const LON_MAX = 56.6;
const LAT_MIN = 23.6;
const LAT_MAX = 26.5;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * SVG_W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * SVG_H;
  return { x, y };
}

// Stylised UAE silhouette — rough vertices in lat/lon, projected at render.
// Good enough to give an at-a-glance "this is UAE" without claiming precision.
const UAE_OUTLINE: Array<{ lat: number; lon: number }> = [
  { lat: 24.2, lon: 51.6 }, // SW corner / Empty Quarter
  { lat: 24.0, lon: 52.5 },
  { lat: 24.4, lon: 53.4 }, // Abu Dhabi Gulf coast
  { lat: 24.7, lon: 54.2 },
  { lat: 25.1, lon: 55.0 }, // Dubai coast
  { lat: 25.3, lon: 55.4 }, // Sharjah coast
  { lat: 25.5, lon: 55.5 },
  { lat: 25.85, lon: 55.95 }, // RAK tip
  { lat: 26.1, lon: 56.2 }, // northern tip
  { lat: 25.6, lon: 56.4 }, // east coast (Hajar)
  { lat: 25.0, lon: 56.4 },
  { lat: 24.6, lon: 56.0 }, // border with Oman south
  { lat: 24.0, lon: 55.7 }, // Al Ain area
  { lat: 23.7, lon: 55.0 },
  { lat: 23.7, lon: 53.0 },
  { lat: 24.2, lon: 51.6 }, // close
];

const TYPE_COLOR: Record<CompanyType, string> = {
  developer: '#6B4F9E',
  design_consultant: '#2B6CB0',
  main_contractor: '#2E7D52',
  mep_consultant: '#D4AF37',
  mep_contractor: '#1F3C6E',
  authority: '#4A5568',
  other: '#C5CDD8',
};

export function GeographicHeatMap({
  companies,
  cities,
}: {
  companies: Company[];
  cities: City[];
}) {
  const [typeFilter, setTypeFilter] = useState<CompanyType | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<Level | 'all' | 'l3plus'>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [hoverCity, setHoverCity] = useState<string | null>(null);

  const captureRef = useRef<HTMLDivElement>(null!);

  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      if (typeFilter !== 'all' && c.company_type !== typeFilter) return false;
      if (levelFilter === 'l3plus') {
        if (!['L3', 'L4', 'L5'].includes(c.current_level)) return false;
      } else if (levelFilter !== 'all' && c.current_level !== levelFilter) {
        return false;
      }
      if (activeFilter === 'active' && !c.has_active_projects) return false;
      if (activeFilter === 'inactive' && c.has_active_projects) return false;
      return true;
    });
  }, [companies, typeFilter, levelFilter, activeFilter]);

  const cityIndex = useMemo(() => {
    const map = new Map<string, City>();
    for (const c of cities) map.set(c.city_name.toLowerCase(), c);
    return map;
  }, [cities]);

  const cityAggregates = useMemo(() => {
    const counts = new Map<string, { city: City; total: number; byType: Map<CompanyType, number> }>();
    for (const c of filteredCompanies) {
      if (!c.city) continue;
      const lookup = cityIndex.get(c.city.toLowerCase());
      if (!lookup) continue;
      const key = lookup.city_name;
      const existing = counts.get(key) ?? {
        city: lookup,
        total: 0,
        byType: new Map<CompanyType, number>(),
      };
      existing.total += 1;
      existing.byType.set(c.company_type, (existing.byType.get(c.company_type) ?? 0) + 1);
      counts.set(key, existing);
    }
    return Array.from(counts.values()).sort((a, b) => b.total - a.total);
  }, [filteredCompanies, cityIndex]);

  const maxCount = cityAggregates[0]?.total ?? 1;
  const unmatched = filteredCompanies.filter(
    (c) => !c.city || !cityIndex.has(c.city.toLowerCase()),
  ).length;

  const outlinePath = UAE_OUTLINE.map((p, i) => {
    const { x, y } = project(p.lat, p.lon);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Geographic heat map</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            UAE stakeholder density by city. Dot area scales with company count.
          </p>
        </div>
        <HeatMapExportButton filename="agsi-geographic-heatmap" targetRef={captureRef} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Showing <strong>{filteredCompanies.length}</strong> of {companies.length} stakeholders
            across <strong>{cityAggregates.length}</strong> cities.
            {unmatched > 0 && ` (${unmatched} not placed — missing or unrecognised city.)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
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
            <Select
              label="Active projects"
              value={activeFilter}
              onChange={(v) => setActiveFilter(v as ActiveFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]" ref={captureRef}>
        <Card>
          <CardContent className="p-2">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="h-auto w-full"
              role="img"
              aria-label="UAE stakeholder density heat map"
            >
              <rect
                x={0}
                y={0}
                width={SVG_W}
                height={SVG_H}
                fill="#F7F9FC"
              />
              <path
                d={outlinePath}
                fill="#E8EDF4"
                stroke="#C5CDD8"
                strokeWidth={1}
              />
              {/* Emirate labels */}
              {EMIRATE_LABELS.map((e) => {
                const { x, y } = project(e.lat, e.lon);
                return (
                  <text
                    key={e.label}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    className="fill-agsi-darkGray"
                    style={{ fontSize: 11, pointerEvents: 'none' }}
                  >
                    {e.label}
                  </text>
                );
              })}
              {/* City dots */}
              {cityAggregates.map(({ city, total, byType }) => {
                const { x, y } = project(city.latitude, city.longitude);
                const r = 6 + Math.sqrt(total / maxCount) * 28;
                const dominant = mostCommonType(byType);
                const fill = dominant ? TYPE_COLOR[dominant] : '#1A2A4A';
                const isHover = hoverCity === city.city_name;
                return (
                  <g key={city.city_name}>
                    <circle
                      cx={x}
                      cy={y}
                      r={r}
                      fill={fill}
                      fillOpacity={isHover ? 0.55 : 0.32}
                      stroke={fill}
                      strokeWidth={1.5}
                      onMouseEnter={() => setHoverCity(city.city_name)}
                      onMouseLeave={() => setHoverCity(null)}
                      style={{ cursor: 'pointer' }}
                    />
                    <text
                      x={x}
                      y={y - r - 4}
                      textAnchor="middle"
                      className="fill-agsi-navy"
                      style={{ fontSize: 11, fontWeight: 600 }}
                    >
                      {city.city_name}
                    </text>
                    <text
                      x={x}
                      y={y + 3}
                      textAnchor="middle"
                      className="fill-white"
                      style={{ fontSize: 11, fontWeight: 700 }}
                    >
                      {total}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-agsi-darkGray">
              <span>Stylised view; not to scale.</span>
              <div className="flex flex-wrap items-center gap-3">
                {COMPANY_TYPES.filter((t) => t !== 'other').map((t) => (
                  <span key={t} className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: TYPE_COLOR[t] }}
                      aria-hidden
                    />
                    {COMPANY_TYPE_LABEL[t]}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cities</CardTitle>
            <CardDescription>Ranked by matching stakeholder count.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {cityAggregates.length === 0 ? (
              <p className="p-4 text-sm text-agsi-darkGray">No cities match these filters.</p>
            ) : (
              <ul className="max-h-[460px] divide-y divide-agsi-lightGray overflow-y-auto">
                {cityAggregates.map(({ city, total, byType }) => (
                  <li
                    key={city.city_name}
                    className={`px-3 py-2 ${hoverCity === city.city_name ? 'bg-agsi-offWhite' : ''}`}
                    onMouseEnter={() => setHoverCity(city.city_name)}
                    onMouseLeave={() => setHoverCity(null)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-agsi-navy">
                        {city.city_name}
                      </span>
                      <Badge variant="neutral">{total}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-agsi-darkGray">{city.emirate}</p>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {Array.from(byType.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([t, n]) => (
                          <span
                            key={t}
                            className="rounded bg-agsi-lightGray px-1.5 py-0.5 text-agsi-darkGray"
                          >
                            {COMPANY_TYPE_LABEL[t]} · {n}
                          </span>
                        ))}
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

function mostCommonType(by: Map<CompanyType, number>): CompanyType | null {
  let best: CompanyType | null = null;
  let bestN = 0;
  for (const [t, n] of by.entries()) {
    if (n > bestN) {
      bestN = n;
      best = t;
    }
  }
  return best;
}

const EMIRATE_LABELS = [
  { label: 'ABU DHABI', lat: 24.2, lon: 53.6 },
  { label: 'DUBAI', lat: 24.95, lon: 55.25 },
  { label: 'SHARJAH', lat: 25.55, lon: 55.55 },
  { label: 'RAK', lat: 25.95, lon: 55.85 },
  { label: 'FUJAIRAH', lat: 25.25, lon: 56.25 },
];
