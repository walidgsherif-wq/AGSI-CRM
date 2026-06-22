'use client';

import { useState, useTransition } from 'react';
import { deleteUser, setUserActive, setUserRole } from '@/server/actions/users';
import { ROLES, ROLE_LABEL, type Role } from '@/types/domain';

export function UserRoleActions({
  userId,
  currentRole,
  isActive,
  canDelete,
  email,
  fullName,
}: {
  userId: string;
  currentRole: Role;
  isActive: boolean;
  /** Hide the Delete button on the caller's own row. */
  canDelete: boolean;
  email: string;
  fullName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function onDelete() {
    const confirmed = window.confirm(
      `Permanently delete ${fullName} (${email})?\n\n` +
        'Their account and profile disappear. Any companies they own, ' +
        'engagements / notes / documents they authored, and tasks they own ' +
        'will SURVIVE but have their owner/author fields cleared (set to null).\n\n' +
        'This cannot be undone.',
    );
    if (!confirmed) return;
    setMessage(null);
    startTransition(async () => {
      const r = await deleteUser(userId);
      if ('error' in r && r.error) {
        setMessage({ kind: 'error', text: r.error });
        return;
      }
      if ('orphaned' in r && r.orphaned) {
        const o = r.orphaned;
        const orphanParts = [
          o.companies > 0 && `${o.companies} compan${o.companies === 1 ? 'y' : 'ies'}`,
          o.engagements > 0 && `${o.engagements} engagement${o.engagements === 1 ? '' : 's'}`,
          o.tasks > 0 && `${o.tasks} task${o.tasks === 1 ? '' : 's'}`,
          o.notes > 0 && `${o.notes} note${o.notes === 1 ? '' : 's'}`,
          o.documents > 0 && `${o.documents} document${o.documents === 1 ? '' : 's'}`,
        ].filter(Boolean);
        setMessage({
          kind: 'ok',
          text:
            orphanParts.length > 0
              ? `Deleted. Orphaned ${orphanParts.join(', ')}.`
              : 'Deleted. No orphaned data.',
        });
      } else {
        setMessage({ kind: 'ok', text: 'Deleted.' });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
        {canDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className="rounded border border-rag-red/40 bg-white px-2 py-1 text-xs text-rag-red hover:bg-rag-red/5 disabled:opacity-50"
            title="Permanently delete this user (test-cleanup convenience)"
          >
            Delete
          </button>
        )}
      </div>
      {message && (
        <p
          className={
            message.kind === 'ok'
              ? 'text-xs2 text-agsi-green'
              : 'text-xs2 text-rag-red'
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
