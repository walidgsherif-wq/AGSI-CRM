'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  rebuildEcosystem,
  backfillEcosystem,
  type BackfillRow,
} from '@/server/actions/ecosystem';

export function RebuildActions() {
  const router = useRouter();
  const [rebuildPending, startRebuild] = useTransition();
  const [backfillPending, startBackfill] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [backfillRows, setBackfillRows] = useState<BackfillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clear() {
    setMessage(null);
    setBackfillRows(null);
    setError(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Rebuild now</CardTitle>
          <CardDescription>
            Recomputes today&apos;s row in <code>ecosystem_awareness_current</code> from the
            event ledger. Safe to run anytime; idempotent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            size="sm"
            disabled={rebuildPending}
            onClick={() => {
              clear();
              startRebuild(async () => {
                const r = await rebuildEcosystem();
                if ('error' in r && r.error) setError(r.error);
                else setMessage('Snapshot rebuilt.');
                router.refresh();
              });
            }}
          >
            {rebuildPending ? 'Rebuilding…' : 'Rebuild now'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backfill historical events</CardTitle>
          <CardDescription>
            One-time replay of existing <code>level_history</code>, <code>engagements</code>,
            and <code>documents</code> rows into the event ledger. Idempotent — re-running is
            safe but will not double-count.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={backfillPending}
            onClick={() => {
              clear();
              if (
                !confirm(
                  'Run backfill? This replays historical level changes, engagements, and documents into the ecosystem ledger. Safe and idempotent.',
                )
              ) {
                return;
              }
              startBackfill(async () => {
                const r = await backfillEcosystem();
                if ('error' in r) setError(r.error);
                else {
                  setBackfillRows(r.rows);
                  setMessage('Backfill complete.');
                }
                router.refresh();
              });
            }}
          >
            {backfillPending ? 'Backfilling…' : 'Run backfill'}
          </Button>

          {backfillRows && backfillRows.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-agsi-darkGray">
                  <th className="py-1">Category</th>
                  <th className="py-1">New events inserted</th>
                </tr>
              </thead>
              <tbody>
                {backfillRows.map((r) => (
                  <tr key={r.category} className="border-t border-agsi-lightGray">
                    <td className="py-1 font-mono text-agsi-navy">{r.category}</td>
                    <td className="py-1 tabular-nums text-agsi-navy">{r.inserted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {(message || error) && (
        <div className="lg:col-span-2">
          {message && <p className="text-sm text-agsi-green">{message}</p>}
          {error && <p className="text-sm text-rag-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
