'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { backfillAllMarketSnapshots } from '@/server/actions/insights';

export function BackfillButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ count?: number; error?: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setStatus(null);
          startTransition(async () => {
            const r = await backfillAllMarketSnapshots();
            if ('error' in r) setStatus({ error: r.error });
            else {
              setStatus({ count: r.snapshots_generated });
              router.refresh();
            }
          });
        }}
      >
        {pending ? 'Backfilling…' : 'Backfill all snapshots'}
      </Button>
      {status?.count !== undefined && (
        <span className="text-xs text-agsi-green">
          Regenerated {status.count} snapshot{status.count === 1 ? '' : 's'}.
        </span>
      )}
      {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
    </div>
  );
}
