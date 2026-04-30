'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  runCompositionDrift,
  runCompositionWarning,
  runStagnationEval,
} from '@/server/actions/notifications-eval';

type ResultRow = { label: string; value: number };

export function EvalActions() {
  const router = useRouter();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <EvalCard
        title="Stagnation"
        description="Fires stagnation_warning at warn-pct and stagnation_breach at 100% per stagnation_rules. Deduped per company per level-entry."
        runLabel="Run stagnation eval"
        run={async () => {
          const r = await runStagnationEval();
          if ('error' in r) throw new Error(r.error);
          return [
            { label: 'Warnings fired', value: r.result.warnings_fired },
            { label: 'Breaches fired', value: r.result.breaches_fired },
          ];
        }}
        onComplete={() => router.refresh()}
      />
      <EvalCard
        title="Composition warning"
        description="End-of-period: if a BDM is on track for Driver A but missing the Driver B/C composition target, fire a composition_warning to BDM + BD Head + admin."
        runLabel="Run composition warning"
        run={async () => {
          const r = await runCompositionWarning();
          if ('error' in r) throw new Error(r.error);
          return [{ label: 'Notifications fired', value: r.result.fired }];
        }}
        onComplete={() => router.refresh()}
      />
      <EvalCard
        title="Composition drift"
        description="Mid-quarter: when a BDM's developer/consultant ratio is trending off target, fire composition_drift early so the quarter can still be corrected."
        runLabel="Run composition drift"
        run={async () => {
          const r = await runCompositionDrift();
          if ('error' in r) throw new Error(r.error);
          return [{ label: 'Notifications fired', value: r.result.fired }];
        }}
        onComplete={() => router.refresh()}
      />
    </div>
  );
}

function EvalCard({
  title,
  description,
  runLabel,
  run,
  onComplete,
}: {
  title: string;
  description: string;
  runLabel: string;
  run: () => Promise<ResultRow[]>;
  onComplete: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            setResults(null);
            startTransition(async () => {
              try {
                const r = await run();
                setResults(r);
                onComplete();
              } catch (e) {
                setError((e as Error).message ?? 'Failed');
              }
            });
          }}
        >
          {pending ? 'Running…' : runLabel}
        </Button>
        {results && (
          <ul className="divide-y divide-agsi-lightGray text-xs">
            {results.map((r) => (
              <li key={r.label} className="flex items-center justify-between py-1">
                <span className="text-agsi-darkGray">{r.label}</span>
                <span className="tabular-nums font-semibold text-agsi-navy">
                  {r.value}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </CardContent>
    </Card>
  );
}
