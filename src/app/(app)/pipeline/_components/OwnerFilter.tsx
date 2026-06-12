'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { OwnerOption } from '@/lib/auth/owner-options';

// Pipeline owner / member filter. Renders a select that navigates on
// change, preserving every other search param (type chip, sort, etc.)
// so it composes AND with them server-side. The L0 toggle and search
// box live inside PipelineKanban as local state and stay untouched.
//
// Empty value = no filter. 'unassigned' = companies with owner_id =
// NULL (handled in pipeline/page.tsx via .is('owner_id', null)).

export function OwnerFilter({
  current,
  options,
}: {
  current: string;
  options: OwnerOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('owner', value);
    else next.delete('owner');
    const qs = next.toString();
    router.push((qs ? `/pipeline?${qs}` : '/pipeline') as never);
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium uppercase tracking-wider text-agsi-darkGray">
        Owner
      </label>
      <select
        value={current}
        onChange={onChange}
        aria-label="Filter pipeline by owning BDM"
        className="rounded border border-agsi-midGray bg-white px-3 py-1 text-xs font-medium text-agsi-navy"
      >
        <option value="">All members</option>
        <option value="unassigned">Unassigned</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
