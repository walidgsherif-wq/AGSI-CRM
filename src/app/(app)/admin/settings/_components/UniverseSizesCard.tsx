'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { updateKpiUniverseSizes } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

export function UniverseSizesCard({
  initialDevelopers,
  initialConsultants,
  initialMainContractors,
  initialEnablingContractors,
}: {
  initialDevelopers: number;
  initialConsultants: number;
  initialMainContractors: number;
  initialEnablingContractors: number;
}) {
  const router = useRouter();
  const [dev, setDev] = useState(initialDevelopers);
  const [con, setCon] = useState(initialConsultants);
  const [mc, setMc] = useState(initialMainContractors);
  const [en, setEn] = useState(initialEnablingContractors);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const total = dev + con + mc + en;
  const dirty =
    dev !== initialDevelopers ||
    con !== initialConsultants ||
    mc !== initialMainContractors ||
    en !== initialEnablingContractors;

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPI universe sizes</CardTitle>
        <CardDescription>
          Total addressable stakeholder counts per company type. Drives the
          ecosystem awareness theoretical_max ({total} × 100 ={' '}
          {(total * 100).toLocaleString()}) and the level-distribution heat-map
          denominator. Default total per playbook §5.1: <strong>789</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Developers" value={dev} onChange={(v) => { setDev(v); setStatus(null); }} />
          <NumberField label="Consultants" value={con} onChange={(v) => { setCon(v); setStatus(null); }} />
          <NumberField label="Main contractors" value={mc} onChange={(v) => { setMc(v); setStatus(null); }} />
          <NumberField label="Enabling contractors" value={en} onChange={(v) => { setEn(v); setStatus(null); }} />
        </div>
        <p className="mt-2 text-xs text-agsi-darkGray">Total = <strong>{total}</strong></p>
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateKpiUniverseSizes({
                developers: dev,
                consultants: con,
                main_contractors: mc,
                enabling_contractors: en,
              });
              if ('error' in r) setStatus({ error: r.error });
              else {
                setStatus({ ok: true });
                router.refresh();
              }
            });
          }}
        />
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}
