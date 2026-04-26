'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteNote, togglePin } from '@/server/actions/notes';

export function NoteActions({
  id,
  companyId,
  isPinned,
  canDelete,
}: {
  id: string;
  companyId: string;
  isPinned: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await togglePin(id, !isPinned, companyId);
            router.refresh();
          });
        }}
        className="text-xs text-agsi-accent hover:underline disabled:opacity-50"
      >
        {isPinned ? 'Unpin' : 'Pin'}
      </button>
      {canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm('Delete this note?')) return;
            startTransition(async () => {
              await deleteNote(id, companyId);
              router.refresh();
            });
          }}
          className="text-xs text-rag-red hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
