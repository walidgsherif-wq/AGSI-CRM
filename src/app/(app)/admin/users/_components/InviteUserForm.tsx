'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { inviteUser } from '@/server/actions/users';
import { ROLES, ROLE_LABEL, type Role } from '@/types/domain';

export function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [role, setRole] = useState<Role>('bd_manager');

  async function onSubmit(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await inviteUser(formData);
      if (result.error) {
        setMessage({ kind: 'error', text: result.error });
      } else {
        setMessage({ kind: 'ok', text: 'Invite sent. They will receive an email shortly.' });
      }
    });
  }

  return (
    <form action={onSubmit} className="grid gap-4 sm:grid-cols-4">
      <div className="sm:col-span-1">
        <label className="block text-xs font-medium text-agsi-darkGray">Full name</label>
        <input
          name="full_name"
          required
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-agsi-darkGray">Email</label>
        <input
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="sm:col-span-1">
        <label className="block text-xs font-medium text-agsi-darkGray">Role</label>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
        {message && (
          <p
            className={
              message.kind === 'ok' ? 'text-xs text-agsi-green' : 'text-xs text-rag-red'
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
