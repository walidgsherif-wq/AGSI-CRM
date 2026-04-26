'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from '@/lib/zod/document';
import { createDocument } from '@/server/actions/documents';

export function DocumentUploadForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPhase(null);
    const form = new FormData(e.currentTarget);
    const file = form.get('file') as File | null;
    if (!file) {
      setError('Choose a file.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('File exceeds 25MB.');
      return;
    }

    startTransition(async () => {
      try {
        // 1) Browser uploads file to documents bucket directly
        setPhase('Uploading file…');
        const supabase = createSupabaseBrowserClient();
        const stamp = Date.now();
        const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
        const storagePath = `${companyId}/${stamp}-${safeName}`;
        const { error: storeErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          });
        if (storeErr) {
          setError(`Upload failed: ${storeErr.message}`);
          return;
        }

        // 2) Server action writes the documents row with the storage_path
        setPhase('Saving…');
        const payload = new FormData();
        payload.set('company_id', companyId);
        payload.set('doc_type', String(form.get('doc_type') ?? ''));
        payload.set('title', String(form.get('title') ?? ''));
        payload.set('storage_path', storagePath);
        payload.set('signed_date', String(form.get('signed_date') ?? ''));
        payload.set('expiry_date', String(form.get('expiry_date') ?? ''));
        const r = await createDocument(payload);
        if (r.error) {
          setError(r.error);
          // best-effort cleanup of orphan file
          await supabase.storage.from('documents').remove([storagePath]);
          return;
        }
        setOpen(false);
        setPhase(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        + Upload document
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">File</label>
          <input
            name="file"
            type="file"
            required
            className="mt-1 block w-full text-sm text-agsi-navy file:mr-3 file:rounded-lg file:border-0 file:bg-agsi-navy file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-agsi-blue"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Title</label>
          <input
            name="title"
            required
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Type</label>
          <select
            name="doc_type"
            required
            defaultValue="other"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Signed date</label>
          <input
            name="signed_date"
            type="date"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Expiry date (optional)</label>
          <input
            name="expiry_date"
            type="date"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? phase ?? 'Working…' : 'Upload'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </form>
  );
}
