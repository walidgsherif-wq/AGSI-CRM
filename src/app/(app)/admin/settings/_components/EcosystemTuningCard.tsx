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
import { updateEcosystemTuning } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

type Eco = {
  decay_window_days: number;
  inactive_company_multiplier: number;
  dedup_window_days: number;
};

export function EcosystemTuningCard({ initial }: { initial: Eco }) {
  const router = useRouter();
  const [vals, setVals] = useState<Eco>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty =
    vals.decay_window_days !== initial.decay_window_days ||
    vals.inactive_company_multiplier !== initial.inactive_company_multiplier ||
    vals.dedup_window_days !== initial.dedup_window_days;

  function set<K extends keyof Eco>(key: K, v: number) {
    setVals({ ...vals, [key]: v });
    setStatus(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ecosystem awareness tuning</CardTitle>
        <CardDescription>
          Decay window, inactive-company multiplier, and dedup window for the
          ecosystem awareness engine. Changes apply to future events;{' '}
          historical events keep their original points. Re-run{' '}
          <a href="/admin/ecosystem-rebuild" className="text-agsi-accent hover:underline">
            Backfill all snapshots
          </a>{' '}
          to propagate the new tuning across the whole snapshot timeline.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Active-window days"
            value={vals.decay_window_days}
            onChange={(v) => set('decay_window_days', v)}
            min={1}
          />
          <NumberField
            label="Inactive multiplier (0–1)"
            value={vals.inactive_company_multiplier}
            onChange={(v) => set('inactive_company_multiplier', v)}
            min={0}
            max={1}
            step={0.05}
          />
          <NumberField
            label="Dedup window days"
            value={vals.dedup_window_days}
            onChange={(v) => set('dedup_window_days', v)}
            min={0}
          />
        </div>
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateEcosystemTuning(vals);
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
