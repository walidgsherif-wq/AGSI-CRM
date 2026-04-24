'use client';

import { useRouter } from 'next/navigation';
import type { Role } from '@/types/domain';
import { ROLES, ROLE_LABEL } from '@/types/domain';
import { DEV_ROLE_COOKIE } from '@/lib/auth/shared';

/**
 * Dev-only role switcher. Writes a cookie the server reads in getCurrentUser().
 * M3 removes this entirely and replaces with a user menu.
 */
export function DevRoleSwitcher({ currentRole }: { currentRole: Role }) {
  const router = useRouter();

  function setRole(role: Role) {
    // Cookie lasts 30 days; path=/ so every route sees it.
    document.cookie = `${DEV_ROLE_COOKIE}=${role}; path=/; max-age=${60 * 60 * 24 * 30}`;
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-agsi-midGray/60 bg-agsi-offWhite p-3">
      <label
        htmlFor="dev-role-switcher"
        className="block text-[10px] font-semibold uppercase tracking-wider text-agsi-darkGray"
      >
        Dev role (M1 only)
      </label>
      <select
        id="dev-role-switcher"
        value={currentRole}
        onChange={(e) => setRole(e.target.value as Role)}
        className="mt-1 w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs text-agsi-navy"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </div>
  );
}
