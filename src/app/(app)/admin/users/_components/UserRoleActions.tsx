'use client';

import { useTransition } from 'react';
import { setUserActive, setUserRole } from '@/server/actions/users';
import { ROLES, ROLE_LABEL, type Role } from '@/types/domain';

export function UserRoleActions({
  userId,
  currentRole,
  isActive,
}: {
  userId: string;
  currentRole: Role;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      <select
        defaultValue={currentRole}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            await setUserRole(userId, e.target.value as Role);
          })
        }
        className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setUserActive(userId, !isActive);
          })
        }
        className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs text-agsi-navy hover:bg-agsi-offWhite disabled:opacity-50"
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </button>
    </div>
  );
}
