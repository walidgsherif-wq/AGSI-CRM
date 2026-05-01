'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { generateMarketSnapshot } from '@/server/actions/insights';

export function GenerateSnapshotButton({
  uploadId,
  hasExisting = false,
}: {
  uploadId: string;
  hasExisting?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const idleLabel = hasExisting ? 'Regenerate snapshot' : 'Generate market snapshot';
  const pendingLabel = hasExisting ? 'Regenerating…' : 'Generating…';

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant={hasExisting ? 'secondary' : 'primary'}
        disabled={pending}
        onClick={() => {
          setStatus(null);
          startTransition(async () => {
            const r = await generateMarketSnapshot(uploadId);
            if ('error' in r) setStatus({ error: r.error });
            else {
              setStatus({ ok: true });
              router.refresh();
            }
          });
        }}
      >
        {pending ? pendingLabel : idleLabel}
      </Button>
      {status?.ok && (
        <span className="text-xs text-agsi-green">
          Snapshot generated. Open /insights to view.
        </span>
      )}
      {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
    </div>
  );
}
