'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { setCrmSetupMode } from '@/server/actions/setup-mode';

export function CrmSetupModeCard({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function flip(next: boolean) {
    setError(null);
    const previous = enabled;
    setEnabled(next); // optimistic
    startTransition(async () => {
      const r = await setCrmSetupMode(next);
      if (r.error) {
        setError(r.error);
        setEnabled(previous); // revert on failure
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CRM setup mode</CardTitle>
        <CardDescription>
          Relax level gates for initial backfill: owners can set the true
          current level of stakeholders they own directly, no single-step
          rule, no approval, no evidence upload. The L2+ completeness
          check (emirate + a work-email contact) is still enforced.
          Backfill moves are audited but do NOT count toward earned
          Driver A.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={pending}
              onChange={(e) => flip(e.target.checked)}
              className="h-4 w-4 rounded border-agsi-midGray"
            />
            <span className="text-sm font-medium text-agsi-navy">
              {enabled ? 'Setup mode is ON' : 'Setup mode is OFF'}
            </span>
          </label>
          {enabled && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => flip(false)}
            >
              Turn off
            </Button>
          )}
          {pending && (
            <span className="text-xs text-agsi-darkGray">Saving&hellip;</span>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-rag-red">{error}</p>}
        {enabled && (
          <p className="mt-3 text-xs text-rag-amber">
            A banner is shown app-wide while this is on so it&rsquo;s
            never silently left enabled.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
