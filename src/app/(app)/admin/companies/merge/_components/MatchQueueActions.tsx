'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveMatch, rejectMatch, createAsNew } from '@/server/actions/bnc';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import type { CompanyType } from '@/types/domain';

export function MatchQueueActions({
  queueId,
  hasSuggestion,
}: {
  queueId: string;
  hasSuggestion: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyType, setCompanyType] = useState<CompanyType>('developer');

  function run(fn: () => Promise<{ error?: string } | { ok: boolean }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ('error' in r && r.error) setError(r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasSuggestion && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => approveMatch(queueId))}
        >
          Approve match
        </Button>
      )}
      <select
        value={companyType}
        onChange={(e) => setCompanyType(e.target.value as CompanyType)}
        disabled={pending}
        className="rounded-lg border border-agsi-midGray bg-white px-2 py-1 text-xs"
      >
        {COMPANY_TYPES.map((t) => (
          <option key={t} value={t}>
            {COMPANY_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => createAsNew(queueId, companyType))}
      >
        Create as new
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => rejectMatch(queueId))}
      >
        Reject
      </Button>
      {error && <span className="text-xs text-rag-red">{error}</span>}
    </div>
  );
}
