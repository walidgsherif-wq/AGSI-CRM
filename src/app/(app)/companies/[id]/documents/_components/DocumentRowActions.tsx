'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { deleteDocument } from '@/server/actions/documents';

export function DocumentRowActions({
  id,
  companyId,
  storagePath,
  canDelete,
}: {
  id: string;
  companyId: string;
  storagePath: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function download() {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) {
      alert(`Could not generate download link: ${error?.message ?? 'unknown'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={download}
        className="text-xs text-agsi-accent hover:underline"
      >
        Download
      </button>
      {canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm('Delete this document and its file?')) return;
            startTransition(async () => {
              await deleteDocument(id, companyId, storagePath);
              router.refresh();
            });
          }}
          className="text-xs text-rag-red hover:underline disabled:opacity-50"
        >
          {pending ? 'Deleting…' : 'Delete'}
        </button>
      )}
    </div>
  );
}
