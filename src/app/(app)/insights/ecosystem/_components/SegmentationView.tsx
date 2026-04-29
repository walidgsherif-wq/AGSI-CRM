'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

type Bucket = { lifetime: number; active: number };
type Snapshot = {
  by_company_type: Record<string, Bucket>;
  by_level: Record<string, Bucket>;
  by_city: Record<string, Bucket>;
};

type Tab = 'type' | 'level' | 'city';

export function SegmentationView({ snapshot }: { snapshot: Snapshot }) {
  const [tab, setTab] = useState<Tab>('type');

  const data = buildData(tab, snapshot);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Segmentation</CardTitle>
            <CardDescription>
              Lifetime + active points broken down by{' '}
              {tab === 'type' ? 'company type' : tab === 'level' ? 'L-level' : 'city'}.
            </CardDescription>
          </div>
          <div className="flex gap-1 text-xs">
            <TabBtn label="By type" active={tab === 'type'} onClick={() => setTab('type')} />
            <TabBtn label="By level" active={tab === 'level'} onClick={() => setTab('level')} />
            <TabBtn label="By city" active={tab === 'city'} onClick={() => setTab('city')} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-agsi-darkGray">No data in this segmentation yet.</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 0, left: 12 }}
              >
                <CartesianGrid stroke="#E8EDF4" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#4A5568' }}
                  stroke="#C5CDD8"
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#4A5568' }}
                  stroke="#C5CDD8"
                  width={140}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid #E8EDF4',
                  }}
                  formatter={(value, name) => [
                    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
                      Number(value),
                    ),
                    String(name) === 'lifetime' ? 'Lifetime' : 'Active (90d)',
                  ]}
                />
                <Bar dataKey="lifetime" fill="#1A2A4A" name="lifetime" />
                <Bar dataKey="active" fill="#2E7D52" name="active" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildData(tab: Tab, snapshot: Snapshot) {
  const source =
    tab === 'type'
      ? snapshot.by_company_type
      : tab === 'level'
        ? snapshot.by_level
        : snapshot.by_city;

  const labelFor = (key: string) => {
    if (tab === 'type') {
      return COMPANY_TYPE_LABEL[key as keyof typeof COMPANY_TYPE_LABEL] ?? key;
    }
    return key;
  };

  return Object.entries(source ?? {})
    .map(([key, val]) => ({
      label: labelFor(key),
      lifetime: Number(val?.lifetime ?? 0),
      active: Number(val?.active ?? 0),
    }))
    .sort((a, b) => b.lifetime - a.lifetime)
    .slice(0, tab === 'city' ? 15 : 10);
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 ${
        active ? 'bg-agsi-navy text-white' : 'bg-agsi-lightGray text-agsi-navy hover:bg-agsi-midGray/40'
      }`}
    >
      {label}
    </button>
  );
}
