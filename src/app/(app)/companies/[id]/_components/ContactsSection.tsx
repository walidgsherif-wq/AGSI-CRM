'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GuardedForm } from '@/components/ui/guarded-form';
import type { Role } from '@/types/domain';
import {
  archiveContact,
  createContact,
  purgeContact,
  restoreContact,
  setPrimaryContact,
  updateContact,
} from '@/server/actions/contacts';

export type ContactRow = {
  id: string;
  company_id: string;
  full_name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export function ContactsSection({
  companyId,
  live,
  archived,
  currentUserId,
  userRole,
}: {
  companyId: string;
  live: ContactRow[];
  archived: ContactRow[];
  currentUserId: string;
  userRole: Role;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const isHeadOrAdmin = userRole === 'admin' || userRole === 'bd_head';
  const canAddContact = userRole !== 'leadership';

  function canMutate(c: ContactRow) {
    return isHeadOrAdmin || c.created_by === currentUserId;
  }

  function run(fn: () => Promise<{ error?: string; ok?: true } | void>) {
    setError(null);
    startTransition(async () => {
      const r = (await fn()) ?? { ok: true as const };
      if (r && 'error' in r && r.error) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-agsi-darkGray">
          {live.length === 0
            ? 'No contacts yet — add the people you work with at this stakeholder.'
            : `${live.length} live contact${live.length === 1 ? '' : 's'}.`}
        </p>
        {canAddContact && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            + Add contact
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-rag-red">{error}</p>}

      {adding && (
        <ContactForm
          mode="create"
          companyId={companyId}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={async (fd) => {
            const r = await createContact(fd);
            if (r.error) {
              setError(r.error);
            } else {
              setAdding(false);
              router.refresh();
            }
          }}
        />
      )}

      {live.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {live.map((c) => (
            <li key={c.id}>
              {editingId === c.id ? (
                <ContactForm
                  mode="edit"
                  companyId={companyId}
                  initial={c}
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (fd) => {
                    const r = await updateContact(fd);
                    if (r.error) {
                      setError(r.error);
                    } else {
                      setEditingId(null);
                      router.refresh();
                    }
                  }}
                  onArchive={
                    canMutate(c)
                      ? () => {
                          run(() => archiveContact(c.id, companyId));
                          setEditingId(null);
                        }
                      : undefined
                  }
                />
              ) : (
                <ContactCard
                  contact={c}
                  canMutate={canMutate(c)}
                  pending={pending}
                  onEdit={() => setEditingId(c.id)}
                  onMakePrimary={() =>
                    run(() => setPrimaryContact(c.id, companyId))
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {isHeadOrAdmin && (
        <div className="rounded-xl border border-agsi-lightGray bg-agsi-offWhite px-4 py-3">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-agsi-darkGray hover:text-agsi-navy"
          >
            <span>Archived contacts · {archived.length}</span>
            <span>{showArchived ? '−' : '+'}</span>
          </button>
          {showArchived && (
            <div className="mt-3 space-y-2">
              {archived.length === 0 ? (
                <p className="text-xs text-agsi-darkGray">
                  No archived contacts.
                </p>
              ) : (
                <ul className="space-y-2">
                  {archived.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-agsi-lightGray bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-agsi-navy">
                          {c.full_name}
                          {c.position && (
                            <span className="ml-2 text-xs text-agsi-darkGray">
                              {c.position}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-agsi-darkGray">
                          archived{' '}
                          {c.deleted_at
                            ? new Date(c.deleted_at).toLocaleDateString()
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() =>
                            run(() => restoreContact(c.id, companyId))
                          }
                        >
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Purge "${c.full_name}" permanently? This cannot be undone.`,
                              )
                            ) {
                              run(() => purgeContact(c.id, companyId));
                            }
                          }}
                        >
                          Purge
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactCard({
  contact,
  canMutate,
  pending,
  onEdit,
  onMakePrimary,
}: {
  contact: ContactRow;
  canMutate: boolean;
  pending: boolean;
  onEdit: () => void;
  onMakePrimary: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-agsi-lightGray bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-agsi-navy">
            {contact.full_name}
          </p>
          {contact.position && (
            <p className="text-xs text-agsi-darkGray">{contact.position}</p>
          )}
        </div>
        {contact.is_primary && <Badge variant="gold">Primary</Badge>}
      </div>
      <div className="space-y-1 text-xs text-agsi-darkGray">
        {contact.email && (
          <p>
            <a
              href={`mailto:${contact.email}`}
              className="text-agsi-accent hover:underline"
            >
              {contact.email}
            </a>
          </p>
        )}
        {contact.phone && (
          <p>
            <a
              href={`tel:${contact.phone}`}
              className="text-agsi-accent hover:underline"
            >
              {contact.phone}
            </a>
          </p>
        )}
        {!contact.email && !contact.phone && (
          <p className="text-agsi-midGray">No contact details on file.</p>
        )}
      </div>
      {canMutate && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {!contact.is_primary && (
            <button
              type="button"
              onClick={onMakePrimary}
              disabled={pending}
              className="text-xs font-medium text-agsi-accent hover:underline disabled:opacity-50"
            >
              Make primary
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="ml-auto text-xs font-medium text-agsi-navy hover:underline disabled:opacity-50"
          >
            Edit
          </button>
          {/* Delete lives inside the Edit view (separated danger zone + */}
          {/* confirm) so it can't be triggered by an accidental click on */}
          {/* the card face. */}
        </div>
      )}
    </div>
  );
}

function ContactForm({
  mode,
  companyId,
  initial,
  pending,
  onSubmit,
  onCancel,
  onArchive,
}: {
  mode: 'create' | 'edit';
  companyId: string;
  initial?: ContactRow;
  pending: boolean;
  onSubmit: (formData: FormData) => Promise<void>;
  onCancel: () => void;
  /** When provided, the form renders a "Danger zone" block at the
   *  bottom with a confirmed Delete (archive) action. Pass undefined
   *  for users who can't delete this contact. */
  onArchive?: () => void;
}) {
  return (
    <GuardedForm
      action={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-accent/40 bg-agsi-accent/5 p-4"
    >
      <input type="hidden" name="company_id" value={companyId} />
      {mode === 'edit' && initial && (
        <input type="hidden" name="id" value={initial.id} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required>
          <Input
            name="full_name"
            defaultValue={initial?.full_name ?? ''}
            required
            autoFocus
          />
        </Field>
        <Field label="Position">
          <Input
            name="position"
            defaultValue={initial?.position ?? ''}
            placeholder="Champion, decision maker, technical lead…"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            defaultValue={initial?.email ?? ''}
          />
        </Field>
        <Field label="Phone">
          <Input
            name="phone"
            type="tel"
            defaultValue={initial?.phone ?? ''}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-agsi-navy">
        <input
          type="checkbox"
          name="is_primary"
          defaultChecked={initial?.is_primary ?? false}
          className="h-4 w-4 rounded border-agsi-midGray"
        />
        Primary contact
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Add contact' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>

      {mode === 'edit' && onArchive && (
        <div className="mt-4 flex justify-end border-t border-agsi-lightGray pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  'Archive this contact? Recoverable by an admin / BD head.',
                )
              ) {
                onArchive();
              }
            }}
            className="text-xs text-agsi-midGray hover:text-rag-red hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </GuardedForm>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-agsi-darkGray">
        {label}
        {required && <span className="ml-0.5 text-rag-red">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
