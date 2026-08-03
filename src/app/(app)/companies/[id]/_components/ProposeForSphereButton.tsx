'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { proposeForSphere } from '@/server/actions/sphere-proposals';

/**
 * Manual "Propose for sphere" action on the company header. Managers
 * see it; admins/heads use the sphere builder to add directly (they
 * shouldn't proxy through a proposal). Rendered ONLY when:
 *   - viewer is bd_manager
 *   - company is not already in the sphere (parent gate)
 *   - no pending or rejected proposal (parent gate + server dedup)
 *
 * The RPC is anti-nag by design — clicking a second time on a company
 * that was proposed elsewhere still deduplicates cleanly with a
 * legible message.
 */
export function ProposeForSphereButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function propose() {
    setMsg(null);
    startTransition(async () => {
      const res = await proposeForSphere(companyId, 'manual');
      if ('error' in res) {
        setMsg(res.error);
        return;
      }
      if (res.proposed) {
        setMsg('Proposed — an admin has been notified.');
        router.refresh();
      } else {
        setMsg(
          res.reason === 'already-covered'
            ? `${companyName} is already in the sphere.`
            : res.reason === 'already-pending'
              ? 'A proposal is already awaiting review.'
              : 'This stakeholder was previously rejected — ask an admin to add it manually.',
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={propose}
      >
        <Target aria-hidden className="mr-1 h-3.5 w-3.5" />
        Propose for sphere
      </Button>
      {msg && <span className="text-xxs text-agsi-darkGray">{msg}</span>}
    </div>
  );
}
