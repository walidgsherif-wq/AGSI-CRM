'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { generateMarketSnapshot } from '@/server/actions/insights';

export function GenerateSnapshotButton({ uploadId }: { uploadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setStatus(null);
          startTransition(async () => {
            const r = await generateMarketSnapshot(uploadId);
            if (r.error) setStatus({ error: r.error });
            else {
              setStatus({ ok: true });
              router.refresh();
            }
          });
        }}
      >
        {pending ? 'Generating…' : 'Generate market snapshot'}
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
