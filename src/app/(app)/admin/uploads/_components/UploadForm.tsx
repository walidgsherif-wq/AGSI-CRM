'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function UploadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [reprocess, setReprocess] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDuplicateOf(null);
    const form = new FormData(e.currentTarget);
    if (reprocess) form.set('reprocess', 'on');

    startTransition(async () => {
      try {
        const res = await fetch('/api/bnc/upload', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 409 && json.duplicate_of) {
            setDuplicateOf(json.duplicate_of);
          }
          setError(json.error ?? `HTTP ${res.status}`);
          return;
        }
        setInfo(
          `Processed ${json.summary.rowsProcessed}/${json.summary.rowsTotal} rows. ` +
            `${json.summary.newProjects} new projects, ${json.summary.unmatchedCompanies} unmatched companies.`,
        );
        router.push(`/admin/uploads/${json.upload_id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">XLSX file</label>
          <input
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="mt-1 block w-full text-sm text-agsi-navy file:mr-3 file:rounded-lg file:border-0 file:bg-agsi-navy file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-agsi-blue"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            File date <span className="text-rag-red">*</span>
          </label>
          <input
            name="file_date"
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-agsi-darkGray">
            The week the BNC export represents. Used to detect duplicates and order uploads.
          </p>
        </div>
      </div>

      {duplicateOf && (
        <label className="flex items-start gap-2 rounded-lg border border-rag-amber/40 bg-rag-amber/10 p-3 text-xs text-agsi-navy">
          <input
            type="checkbox"
            checked={reprocess}
            onChange={(e) => setReprocess(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded"
          />
          <span>
            An upload for this date already exists. Tick to <strong>reprocess intentionally</strong>{' '}
            (creates a new upload row; the prior one stays in history).
          </span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Processing… (up to 60s)' : 'Upload + process'}
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
        {info && <p className="text-xs text-agsi-green">{info}</p>}
      </div>
    </form>
  );
}
