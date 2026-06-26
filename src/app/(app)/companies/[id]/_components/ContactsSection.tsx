'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
                />
              ) : (
                <ContactCard
                  contact={c}
                  canMutate={canMutate(c)}
                  pending={pending}
                  onEdit={() => setEditingId(c.id)}
                  onArchive={() =>
                    run(() => archiveContact(c.id, companyId))
                  }
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
  onArchive,
  onMakePrimary,
}: {
  contact: ContactRow;
  canMutate: boolean;
  pending: boolean;
  onEdit: () => void;
  onArchive: () => void;
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
            className="text-xs font-medium text-agsi-navy hover:underline disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={pending}
            className="ml-auto text-xs font-medium text-rag-red hover:underline disabled:opacity-50"
          >
            Delete
          </button>
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
}: {
  mode: 'create' | 'edit';
  companyId: string;
  initial?: ContactRow;
  pending: boolean;
  onSubmit: (formData: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  // Dirty-tracking guard. Any user input flips `dirty`; while dirty,
  // navigation away triggers a confirmation:
  //   - browser-level (tab close, refresh, back/forward, URL bar
  //     change) → native "Leave site?" prompt via beforeunload.
  //   - in-app SPA navigation (sidebar Link click, breadcrumb,
  //     anywhere else) → window.confirm intercept on the captured
  //     <a> click before Next.js's router handles it.
  // Server-action submit and the Cancel button both clear dirty
  // before navigating away.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    function onAnchorClick(e: MouseEvent) {
      // Modified clicks (cmd+click, middle-click, etc.) open in a
      // new tab and don't lose this page's state.
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = (e.target as HTMLElement | null)?.closest?.('a');
      if (!target) return;
      const href = target.getAttribute('href');
      if (!href) return;
      // Skip in-page anchors, mailto/tel, target=_blank, downloads
      if (href.startsWith('#')) return;
      if (target.target === '_blank') return;
      if (target.hasAttribute('download')) return;
      if (/^(mailto:|tel:)/i.test(href)) return;
      if (
        !window.confirm(
          'Discard unsaved contact changes? Your edits will be lost.',
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        setDirty(false);
      }
    }
    document.addEventListener('click', onAnchorClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onAnchorClick, true);
    };
  }, [dirty]);

  function confirmDiscardIfDirty(): boolean {
    if (!dirty) return true;
    return window.confirm(
      'Discard unsaved contact changes? Your edits will be lost.',
    );
  }

  return (
    <form
      action={async (fd) => {
        setDirty(false);
        await onSubmit(fd);
      }}
      onInput={() => {
        if (!dirty) setDirty(true);
      }}
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
      {mode === 'create' && (
        <label className="flex items-center gap-2 text-xs text-agsi-navy">
          <input
            type="checkbox"
            name="is_primary"
            className="h-4 w-4 rounded border-agsi-midGray"
          />
          Primary contact
        </label>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Add contact' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirmDiscardIfDirty()) {
              setDirty(false);
              onCancel();
            }
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
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
