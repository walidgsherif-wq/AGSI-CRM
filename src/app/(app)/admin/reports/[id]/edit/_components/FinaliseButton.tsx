'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  archiveReport,
  finaliseReport,
  regenerateReportPdf,
} from '@/server/actions/leadership-reports';

export function FinaliseButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pdfWarning, setPdfWarning] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (
              !confirm(
                'Finalise & send to leadership? This locks the report (no further edits to summary, narratives, or payload), captures a PDF snapshot to Storage, and notifies every active leadership user.',
              )
            ) {
              return;
            }
            setError(null);
            setPdfWarning(null);
            startTransition(async () => {
              const r = await finaliseReport(reportId);
              if ('error' in r) {
                setError(r.error ?? 'Finalise failed');
              } else {
                if (!r.pdf_persisted) {
                  setPdfWarning(
                    `Finalised, but PDF persist failed (${r.pdf_error ?? 'unknown'}). Retry from the report's PDF section.`,
                  );
                }
                router.refresh();
              }
            });
          }}
        >
          {pending ? 'Finalising…' : 'Finalise & Send to Leadership'}
        </Button>
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
      {pdfWarning && <p className="text-xs text-rag-amber">{pdfWarning}</p>}
    </div>
  );
}

export function RegeneratePdfButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setStatus(null);
          startTransition(async () => {
            const r = await regenerateReportPdf(reportId);
            if ('error' in r) setStatus({ error: r.error });
            else {
              setStatus({ ok: true });
              router.refresh();
            }
          });
        }}
      >
        {pending ? 'Regenerating…' : 'Regenerate PDF'}
      </Button>
      {status?.ok && <span className="text-xs text-agsi-green">PDF regenerated.</span>}
      {status?.error && <span className="text-xs text-rag-red">{status.error}</span>}
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
