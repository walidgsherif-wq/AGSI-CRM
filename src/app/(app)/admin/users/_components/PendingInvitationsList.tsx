'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { revokeInvite } from '@/server/actions/users';
import { ROLE_LABEL, type Role } from '@/types/domain';

export type PendingInvite = {
  email: string;
  role: Role;
  full_name: string;
  invited_at: string;
};

export function PendingInvitationsList({ invites }: { invites: PendingInvite[] }) {
  if (invites.length === 0) {
    return (
      <p className="text-sm text-agsi-darkGray">
        No pending invitations. Use the form above to invite someone.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-agsi-lightGray">
      {invites.map((inv) => (
        <PendingInviteRow key={inv.email} invite={inv} />
      ))}
    </ul>
  );
}

function PendingInviteRow({ invite }: { invite: PendingInvite }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRevoke() {
    if (!window.confirm(`Revoke invitation for ${invite.email}?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await revokeInvite(invite.email);
      if ('error' in r && r.error) setError(r.error);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-agsi-navy">{invite.full_name}</span>
          <Badge variant="amber">Awaiting first sign-in</Badge>
        </div>
        <p className="mt-0.5 text-xs text-agsi-darkGray">
          {invite.email} · invited {new Date(invite.invited_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="neutral">{ROLE_LABEL[invite.role]}</Badge>
        <button
          type="button"
          disabled={pending}
          onClick={onRevoke}
          className="rounded border border-rag-red/40 bg-white px-2 py-1 text-xs text-rag-red hover:bg-rag-red/5 disabled:opacity-50"
        >
          {pending ? 'Revoking…' : 'Revoke'}
        </button>
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
    </li>
  );
}
