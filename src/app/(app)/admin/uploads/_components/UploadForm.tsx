'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type RawRow = Record<string, string | null>;

const HEADER_HINTS = ['reference number', 'project name', 'reference no', 'project ref'];

function looksLikeHeader(row: unknown[]): boolean {
  const lc = row
    .map((v) => (typeof v === 'string' ? v.toLowerCase().trim() : ''))
    .filter(Boolean);
  return HEADER_HINTS.some((hint) => lc.some((cell) => cell.includes(hint)));
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

/** Browser-side XLSX parser with auto-detected header row. */
function parseWorkbook(buffer: ArrayBuffer): { rows: RawRow[]; headerRowIndex: number } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Workbook has no sheets.');
  const sheet = wb.Sheets[firstSheetName];
  const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, sheetRows.length); i++) {
    if (looksLikeHeader(sheetRows[i] ?? [])) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error(
      'Could not locate header row. Expected "Reference Number" or "Project Name" within first 10 rows.',
    );
  }

  const headerRaw = sheetRows[headerRowIndex] ?? [];
  const headers = headerRaw.map((h) =>
    typeof h === 'string' ? h.trim() : String(h ?? '').trim(),
  );

  const dataRows: RawRow[] = [];
  for (let r = headerRowIndex + 1; r < sheetRows.length; r++) {
    const row = sheetRows[r] ?? [];
    if (row.every((v) => v === null || v === '')) continue;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = cellToString(row[c]);
    }
    dataRows.push(obj);
  }

  return { rows: dataRows, headerRowIndex };
}

export function UploadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [reprocess, setReprocess] = useState(false);

  // Tick a 1-second elapsed counter while the request is in flight so the
  // user sees the page is working. Resets on completion.
  useEffect(() => {
    if (!pending) {
      setElapsed(0);
      return;
    }
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [pending]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDuplicateOf(null);
    setProgress(null);

    const form = new FormData(e.currentTarget);
    const file = form.get('file') as File | null;
    const fileDate = String(form.get('file_date') ?? '');
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    if (!fileDate) {
      setError('Pick a file date.');
      return;
    }

    startTransition(async () => {
      try {
        // 1) Browser parses XLSX (unlimited CPU)
        setProgress('Parsing workbook…');
        const buffer = await file.arrayBuffer();
        let rows: RawRow[];
        try {
          ({ rows } = parseWorkbook(buffer));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        if (rows.length === 0) {
          setError('Workbook contained no data rows.');
          return;
        }

        // 2) Browser uploads file to Storage (RLS gates to admin via session JWT)
        setProgress(`Uploading file (${rows.length} rows parsed)…`);
        const supabase = createSupabaseBrowserClient();
        const stamp = Date.now();
        const storagePath = `${fileDate}/${stamp}-${file.name}`;
        const { error: storeErr } = await supabase.storage
          .from('bnc-uploads')
          .upload(storagePath, buffer, {
            contentType:
              file.type ||
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: false,
          });
        if (storeErr) {
          setError(`Storage upload failed: ${storeErr.message}`);
          return;
        }

        // 3) Browser POSTs JSON to Edge Function (no XLSX dep there)
        setProgress(`Resolving ${rows.length} rows on the server…`);
        const { data, error: invokeErr } = await supabase.functions.invoke(
          'bnc-upload-process',
          {
            body: {
              file_date: fileDate,
              filename: file.name,
              storage_path: storagePath,
              rows,
              reprocess,
            },
          },
        );
        if (invokeErr) {
          const ctx = invokeErr.context as Response | undefined;
          let payload: Record<string, unknown> | null = null;
          if (ctx) {
            try {
              payload = JSON.parse(await ctx.text()) as Record<string, unknown>;
            } catch {
              // not JSON
            }
          }
          if (payload) {
            if (typeof payload.duplicate_of === 'string') {
              setDuplicateOf(payload.duplicate_of);
            }
            setError((payload.error as string) ?? invokeErr.message);
          } else {
            setError(invokeErr.message);
          }
          return;
        }
        const json = (data as Record<string, unknown> | null) ?? null;
        if (!json) {
          setError('Empty response from Edge Function.');
          return;
        }
        const summary = json?.summary as
          | {
              rowsProcessed: number;
              rowsTotal: number;
              newProjects: number;
              unmatchedCompanies: number;
            }
          | undefined;
        const uploadId = json?.upload_id as string | undefined;
        if (!summary || !uploadId) {
          setError('Server returned no summary.');
          return;
        }
        setInfo(
          `Processed ${summary.rowsProcessed}/${summary.rowsTotal} rows. ` +
            `${summary.newProjects} new projects, ${summary.unmatchedCompanies} unmatched companies.`,
        );
        setProgress(null);
        router.push(`/admin/uploads/${uploadId}`);
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

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? progress ?? 'Working…' : 'Upload + process'}
          </Button>
          {pending && (
            <p className="text-xs tabular text-agsi-darkGray">
              {elapsed}s elapsed
              {elapsed > 30 && ' — large files take ~60-90s, please wait…'}
            </p>
          )}
          {error && <p className="text-xs text-rag-red">{error}</p>}
          {info && <p className="text-xs text-agsi-green">{info}</p>}
        </div>
        {pending && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-agsi-lightGray">
            <div
              className="h-full bg-agsi-accent transition-all duration-700 ease-out"
              style={{
                // Indeterminate-feeling progress: asymptotically approaches 95%
                // over ~90s so it never falsely hits 100% before the server
                // responds. Final 100% comes from completion redirect.
                width: `${Math.min(95, 100 * (1 - Math.exp(-elapsed / 30)))}%`,
              }}
            />
          </div>
        )}
      </div>
    </form>
  );
}
