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
import { updateBeiWeightings } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

export function BeiWeightingsCard({
  initialA,
  initialB,
  initialC,
  initialD,
}: {
  initialA: number;
  initialB: number;
  initialC: number;
  initialD: number;
}) {
  const router = useRouter();
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [c, setC] = useState(initialC);
  const [d, setD] = useState(initialD);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const sum = a + b + c + d;
  const dirty =
    a !== initialA || b !== initialB || c !== initialC || d !== initialD;
  const valid = sum === 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle>BEI weightings</CardTitle>
        <CardDescription>
          Per-driver weighting in the Bonus Eligibility Index calculation. Per
          §3.15 the four weightings <strong>must sum to 100</strong>. Playbook
          default: A=45, B=20, C=20, D=15.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          <NumberField label="Driver A" value={a} onChange={(v) => { setA(v); setStatus(null); }} />
          <NumberField label="Driver B" value={b} onChange={(v) => { setB(v); setStatus(null); }} />
          <NumberField label="Driver C" value={c} onChange={(v) => { setC(v); setStatus(null); }} />
          <NumberField label="Driver D" value={d} onChange={(v) => { setD(v); setStatus(null); }} />
        </div>
        <p className={`mt-2 text-xs ${valid ? 'text-agsi-darkGray' : 'text-rag-red'}`}>
          Sum: <strong>{sum}</strong> {valid ? '(valid)' : '(must equal 100)'}
        </p>
        <SaveBar
          pending={pending}
          dirty={dirty && valid}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateBeiWeightings({ A: a, B: b, C: c, D: d });
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
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}
