'use client';

import { useTransition } from 'react';
import { deleteEngagement } from '@/server/actions/engagements';

export function DeleteEngagementButton({
  id,
  companyId,
}: {
  id: string;
  companyId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this engagement?')) return;
        startTransition(async () => {
          await deleteEngagement(id, companyId);
        });
      }}
      className="text-xs text-rag-red hover:underline disabled:opacity-50"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  );
}
