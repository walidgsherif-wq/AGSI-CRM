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
import { updateRebarSettings } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

type Rebar = {
  window_pct: number;
  share_of_value: number;
  price_per_tonne_aed: number;
};

export function RebarCard({ initial }: { initial: Rebar }) {
  const router = useRouter();
  const [vals, setVals] = useState<Rebar>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty =
    vals.window_pct !== initial.window_pct ||
    vals.share_of_value !== initial.share_of_value ||
    vals.price_per_tonne_aed !== initial.price_per_tonne_aed;

  function set<K extends keyof Rebar>(key: K, v: number) {
    setVals({ ...vals, [key]: v });
    setStatus(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rebar economics</CardTitle>
        <CardDescription>
          Default values for the rebar consumption window section on{' '}
          /insights. The price here is the fallback used when no monthly entry
          covers a given snapshot date — for accurate historical snapshots add
          monthly entries via{' '}
          <a href="/admin/rebar-prices" className="text-agsi-accent hover:underline">
            Admin → Rebar prices
          </a>
          . After saving, click <strong>Backfill all snapshots</strong> there to
          propagate the change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Consumption window (% of construction)"
            value={vals.window_pct}
            onChange={(v) => set('window_pct', v)}
            min={1}
            max={100}
          />
          <NumberField
            label="Share of project value (0–1)"
            value={vals.share_of_value}
            onChange={(v) => set('share_of_value', v)}
            min={0}
            max={1}
            step={0.005}
          />
          <NumberField
            label="Fallback price (AED / tonne)"
            value={vals.price_per_tonne_aed}
            onChange={(v) => set('price_per_tonne_aed', v)}
            min={1}
          />
        </div>
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateRebarSettings(vals);
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
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}
