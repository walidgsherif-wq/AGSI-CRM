'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markCompaniesDistinct } from '@/server/actions/merge';

export function MarkDistinctButton({
  aId,
  bId,
}: {
  aId: string;
  bId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt(
          'Mark this pair as distinct — reason (optional):',
        );
        if (reason === null) return; // cancelled
        startTransition(async () => {
          const r = await markCompaniesDistinct({
            aId,
            bId,
            reason: reason.trim() || null,
          });
          if (r.error) window.alert(r.error);
          else router.refresh();
        });
      }}
      className="text-xs text-agsi-darkGray hover:text-agsi-navy hover:underline disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Mark distinct'}
    </button>
  );
}
