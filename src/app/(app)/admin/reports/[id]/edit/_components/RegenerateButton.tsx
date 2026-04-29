'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { regenerateReport } from '@/server/actions/leadership-reports';

export function RegenerateButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              'Regenerate this draft? This re-runs the aggregation against current data and discards any per-stakeholder narratives that were previously written.',
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const r = await regenerateReport(reportId);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? 'Regenerating…' : 'Regenerate'}
      </Button>
      {error && <span className="text-xs text-rag-red">{error}</span>}
    </div>
  );
}
