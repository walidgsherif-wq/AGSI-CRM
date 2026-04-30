'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { archiveReport, finaliseReport } from '@/server/actions/leadership-reports';

export function FinaliseButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              'Finalise & send to leadership? This locks the report (no further edits to summary, narratives, or payload) and notifies every active leadership user.',
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const r = await finaliseReport(reportId);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? 'Finalising…' : 'Finalise & Send to Leadership'}
      </Button>
      {error && <span className="text-xs text-rag-red">{error}</span>}
    </div>
  );
}

export function ArchiveButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              'Archive this report? It stays readable in the leadership archive but no longer appears as awaiting feedback. Cannot be reverted to finalised.',
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const r = await archiveReport(reportId);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? 'Archiving…' : 'Archive report'}
      </Button>
      {error && <span className="text-xs text-rag-red">{error}</span>}
    </div>
  );
}
