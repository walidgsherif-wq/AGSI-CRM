'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  setFeatureOverride,
  clearFeatureOverride,
} from '@/server/actions/feature-access';
import type { FeatureKey } from '@/lib/auth/features';

export type FeatureRow = {
  key: FeatureKey;
  label: string;
  description: string;
  /** Whether the user's role gets this feature by default. */
  defaultAllowed: boolean;
  /** Explicit override, or null when none is set. */
  override: boolean | null;
};

type Choice = 'default' | 'allow' | 'deny';

function choiceFor(row: FeatureRow): Choice {
  if (row.override === null) return 'default';
  return row.override ? 'allow' : 'deny';
}

export function FeatureAccessEditor({
  userId,
  rows,
}: {
  userId: string;
  rows: FeatureRow[];
}) {
  return (
    <div className="divide-y divide-agsi-lightGray">
      {rows.map((row) => (
        <FeatureRowControl key={row.key} userId={userId} row={row} />
      ))}
    </div>
  );
}

function FeatureRowControl({ userId, row }: { userId: string; row: FeatureRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = choiceFor(row);

  const effective = row.override === null ? row.defaultAllowed : row.override;

  function apply(choice: Choice) {
    if (choice === current) return;
    setError(null);
    startTransition(async () => {
      const r =
        choice === 'default'
          ? await clearFeatureOverride(userId, row.key)
          : await setFeatureOverride(userId, row.key, choice === 'allow');
      if ('error' in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-agsi-navy">{row.label}</span>
          {effective ? (
            <Badge variant="green">Visible</Badge>
          ) : (
            <Badge variant="neutral">Hidden</Badge>
          )}
          {row.override !== null && <Badge variant="amber">override</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-agsi-darkGray">{row.description}</p>
        <p className="mt-0.5 text-[11px] text-agsi-midGray">
          Role default: {row.defaultAllowed ? 'visible' : 'hidden'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <SegButton label="Default" active={current === 'default'} disabled={pending} onClick={() => apply('default')} />
        <SegButton label="Allow" active={current === 'allow'} disabled={pending} onClick={() => apply('allow')} />
        <SegButton label="Deny" active={current === 'deny'} disabled={pending} onClick={() => apply('deny')} />
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
    </div>
  );
}

function SegButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        active
          ? 'rounded border border-agsi-navy bg-agsi-navy px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50'
          : 'rounded border border-agsi-midGray bg-white px-2.5 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-offWhite disabled:opacity-50'
      }
    >
      {label}
    </button>
  );
}
