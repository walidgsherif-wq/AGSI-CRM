'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function SnapshotPicker({
  dates,
  primary,
  compare,
}: {
  dates: string[];
  primary: string;
  compare: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(next: { snapshot?: string; compare?: string | null }) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next.snapshot !== undefined) sp.set('snapshot', next.snapshot);
    if (next.compare === null) sp.delete('compare');
    else if (next.compare !== undefined) sp.set('compare', next.compare);
    router.push(`/insights?${sp.toString()}` as never);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col">
        <span className="mb-1 text-xs font-medium text-agsi-darkGray">Snapshot</span>
        <select
          value={primary}
          onChange={(e) => update({ snapshot: e.target.value })}
          className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
        >
          {dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        <span className="mb-1 text-xs font-medium text-agsi-darkGray">Compare to</span>
        <select
          value={compare ?? ''}
          onChange={(e) => update({ compare: e.target.value || null })}
          className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
        >
          <option value="">— None —</option>
          {dates
            .filter((d) => d !== primary)
            .map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
