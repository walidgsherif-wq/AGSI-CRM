'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { inviteUser } from '@/server/actions/users';
import { ROLES, ROLE_LABEL, type Role } from '@/types/domain';
import { GuardedForm } from '@/components/ui/guarded-form';

export function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [role, setRole] = useState<Role>('bd_manager');

  async function onSubmit(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await inviteUser(formData);
      if ('error' in result && result.error) {
        setMessage({ kind: 'error', text: result.error });
      } else if ('message' in result && result.message) {
        // result.message tells the admin whether this was a fresh
        // invite or a re-sent link for an existing user.
        setMessage({ kind: 'ok', text: result.message });
      } else {
        setMessage({ kind: 'ok', text: 'Done.' });
      }
    });
  }

  return (
    <GuardedForm action={onSubmit} className="grid gap-4 sm:grid-cols-4">
      <div className="sm:col-span-1">
        <label className="block text-xs font-medium text-agsi-darkGray">Full name</label>
        <Input name="full_name" required className="mt-1" />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-agsi-darkGray">Email</label>
        <Input name="email" type="email" required className="mt-1" />
      </div>
      <div className="sm:col-span-1">
        <label className="block text-xs font-medium text-agsi-darkGray">Role</label>
        <Select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="mt-1"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add user'}
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
    </GuardedForm>
  );
}
