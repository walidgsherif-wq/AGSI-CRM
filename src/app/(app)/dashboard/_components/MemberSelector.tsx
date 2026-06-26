'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export type BdMember = {
  id: string;
  full_name: string;
  role: 'admin' | 'bd_head' | 'bd_manager';
};

/**
 * Dashboard scope selector for admin / bd_head. Drives the
 * `?member=` URL param so the chosen view persists and is shareable.
 *
 * Values:
 *   - 'team'      → user_id IS NULL (team rollup row written by rebuild_kpi_actuals)
 *   - 'self'      → the logged-in admin / bd_head's own actuals
 *   - <uuid>      → a specific BD member's actuals
 */
export function MemberSelector({
  members,
  currentSelection,
  currentUserId,
}: {
  members: BdMember[];
  /** 'team' | 'self' | a BD member uuid. */
  currentSelection: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(searchParams.toString());
    if (e.target.value === 'team') next.delete('member');
    else next.set('member', e.target.value);
    const qs = next.toString();
    router.push((qs ? `/dashboard?${qs}` : '/dashboard') as never);
  }

  // Self is shown by name (own profile) — admins viewing their own
  // contributions in a "BDM-style" tile. Other members listed
  // alphabetically.
  const self = members.find((m) => m.id === currentUserId);
  const others = members
    .filter((m) => m.id !== currentUserId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <label className="flex items-center gap-2 text-xs text-agsi-darkGray">
      <span className="font-medium uppercase tracking-wider">Viewing</span>
      <select
        value={currentSelection}
        onChange={onChange}
        aria-label="Dashboard scope"
        className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs font-medium text-agsi-navy"
      >
        <option value="team">Team rollup</option>
        {self && (
          <option value="self">Yourself ({self.full_name})</option>
        )}
        {others.length > 0 && (
          <optgroup label="Team members">
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
