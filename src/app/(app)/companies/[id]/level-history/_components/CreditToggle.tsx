'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLevelHistoryCredited } from '@/server/actions/level';

export function CreditToggle({
  historyId,
  isCredited,
}: {
  historyId: string;
  isCredited: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-agsi-darkGray">
      <input
        type="checkbox"
        defaultChecked={isCredited}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          startTransition(async () => {
            await setLevelHistoryCredited(historyId, next);
            router.refresh();
          });
        }}
        className="h-3.5 w-3.5 rounded"
      />
      Credited
    </label>
  );
}
