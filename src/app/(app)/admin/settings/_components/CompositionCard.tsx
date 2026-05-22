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
import {
  updateCompositionWarning,
  updateCompositionDrift,
} from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

type Drift = {
  min_quarter_pct: number;
  min_sample_size: number;
  ratio_threshold: number;
  cooldown_days: number;
};

export function CompositionCard({
  initialHeadlinePct,
  initialCompositionPct,
  initialDrift,
}: {
  initialHeadlinePct: number;
  initialCompositionPct: number;
  initialDrift: Drift;
}) {
  const router = useRouter();
  const [headline, setHeadline] = useState(initialHeadlinePct);
  const [composition, setComposition] = useState(initialCompositionPct);
  const [drift, setDrift] = useState<Drift>(initialDrift);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty =
    headline !== initialHeadlinePct ||
    composition !== initialCompositionPct ||
    drift.min_quarter_pct !== initialDrift.min_quarter_pct ||
    drift.min_sample_size !== initialDrift.min_sample_size ||
    drift.ratio_threshold !== initialDrift.ratio_threshold ||
    drift.cooldown_days !== initialDrift.cooldown_days;

  function field<K extends keyof Drift>(key: K) {
    return {
      value: drift[key],
      onChange: (v: number) => {
        setDrift({ ...drift, [key]: v });
        setStatus(null);
      },
    };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Composition warning + drift</CardTitle>
        <CardDescription>
          End-of-quarter and mid-quarter triggers per §3.12 / §3.12b. Both jobs
          run from <a href="/admin/notifications-eval" className="text-agsi-accent hover:underline">
            Admin → Notifications eval
          </a>{' '}
          and use these thresholds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
              End-of-quarter warning
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Headline-hit threshold (% of target)"
                value={headline}
                onChange={(v) => { setHeadline(v); setStatus(null); }}
                min={0}
                max={200}
              />
              <NumberField
                label="Composition-miss threshold (% of target)"
                value={composition}
                onChange={(v) => { setComposition(v); setStatus(null); }}
                min={0}
                max={100}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
              Mid-quarter drift early-warning
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField label="Min quarter % complete" {...field('min_quarter_pct')} min={0} max={100} />
              <NumberField label="Min L3+ moves sampled" {...field('min_sample_size')} min={1} />
              <NumberField label="Ratio threshold (0–1)" {...field('ratio_threshold')} step={0.05} min={0} max={1} />
              <NumberField label="Cooldown days" {...field('cooldown_days')} min={0} />
            </div>
          </div>
        </div>
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r1 = await updateCompositionWarning({
                headline_pct: headline,
                composition_pct: composition,
              });
              if ('error' in r1) {
                setStatus({ error: r1.error });
                return;
              }
              const r2 = await updateCompositionDrift(drift);
              if ('error' in r2) setStatus({ error: r2.error });
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
