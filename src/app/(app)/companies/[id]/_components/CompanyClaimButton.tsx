'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { claimCompany } from '@/server/actions/companies';

/**
 * Shown above the Details card on /companies/[id] when the company is
 * unowned and the viewer is allowed to claim (admin / bd_head /
 * bd_manager — leadership is filtered upstream by the page).
 *
 * Calls the claim_company SECURITY DEFINER RPC via the server action,
 * then router.refresh() so the page re-renders with the new owner —
 * editable form, full self-serve access.
 */
export function CompanyClaimButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClaim() {
    setError(null);
    startTransition(async () => {
      const r = await claimCompany(companyId);
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-agsi-accent/40 bg-agsi-accent/5 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-agsi-navy">
          This stakeholder is unowned.
        </p>
        <p className="text-xs text-agsi-darkGray">
          Claim it to assign yourself as owner. You’ll be able to log
          engagements, edit details, and request level changes.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {error && <p className="text-xs text-rag-red">{error}</p>}
        <Button onClick={onClaim} disabled={pending}>
          {pending ? 'Claiming…' : 'Claim this company'}
        </Button>
      </div>
    </div>
  );
}
