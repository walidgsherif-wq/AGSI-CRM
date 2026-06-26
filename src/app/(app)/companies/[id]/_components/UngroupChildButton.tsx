'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ungroupChild } from '@/server/actions/groups';

/**
 * Admin-only direct ungroup. Non-destructive — just nulls
 * parent_company_id. Reversible by a new grouping request.
 */
export function UngroupChildButton({
  childId,
  childName,
}: {
  childId: string;
  childName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go() {
    if (
      !window.confirm(
        `Remove "${childName}" from this group? It stays a normal company; only the holding link is cleared.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await ungroupChild(childId);
      if (r.error) window.alert(r.error);
      else router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className="text-xs text-agsi-midGray hover:text-rag-red hover:underline disabled:opacity-50"
    >
      Ungroup
    </button>
  );
}
