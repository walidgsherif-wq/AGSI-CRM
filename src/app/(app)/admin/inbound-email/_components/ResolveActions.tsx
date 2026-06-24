'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  resolveUnmatchedEmail,
  discardUnmatchedEmail,
} from '@/server/actions/inbound-email';

type CompanyOption = { id: string; canonical_name: string };

export function ResolveActions({
  unmatchedId,
  companies,
  fromEmail,
  fromName,
}: {
  unmatchedId: string;
  companies: CompanyOption[];
  /** The sender of the queued email — offered as the contact email to
   *  save against the resolved company so the next email from the same
   *  address auto-matches. */
  fromEmail: string;
  fromName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [note, setNote] = useState('');
  const [discardMode, setDiscardMode] = useState(false);

  // Save-as-contact controls.
  const [saveContact, setSaveContact] = useState(true);
  const [contactFullName, setContactFullName] = useState(
    fromName ?? deriveNameFromEmail(fromEmail),
  );

  function resolve() {
    if (!companyId) {
      setError('Pick a company.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await resolveUnmatchedEmail(
        unmatchedId,
        companyId,
        note.trim() || null,
        saveContact
          ? { email: fromEmail, full_name: contactFullName }
          : null,
      );
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.contact_warning) {
        // Resolution succeeded; just note the contact-save problem.
        setError(`Resolved, but contact not saved: ${r.contact_warning}`);
      }
      setCompanyId('');
      setNote('');
      router.refresh();
    });
  }

  function discard() {
    if (!note.trim()) {
      setError('Add a reason for discarding.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await discardUnmatchedEmail(unmatchedId, note);
      if (r.error) setError(r.error);
      else {
        setNote('');
        setDiscardMode(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {!discardMode && (
        <>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={pending}
            className="w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
          >
            <option value="">— Pick a company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.canonical_name}
              </option>
            ))}
          </select>

          <label className="flex items-start gap-2 text-xs text-agsi-navy">
            <input
              type="checkbox"
              checked={saveContact}
              onChange={(e) => setSaveContact(e.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 rounded border-agsi-midGray"
            />
            <span>
              Save <span className="font-medium">{fromEmail}</span> as a
              contact on the selected company. Next email from this
              address will auto-match.
            </span>
          </label>
          {saveContact && (
            <Input
              value={contactFullName}
              onChange={(e) => setContactFullName(e.target.value)}
              disabled={pending}
              placeholder="Contact full name"
            />
          )}
        </>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={discardMode ? 'Reason for discarding (required)…' : 'Optional note…'}
        rows={2}
        className="w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        {!discardMode ? (
          <>
            <Button size="sm" disabled={pending} onClick={resolve}>
              {pending ? 'Working…' : 'Resolve & create engagement'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setDiscardMode(true)}
            >
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="danger" disabled={pending} onClick={discard}>
              {pending ? 'Working…' : 'Confirm discard'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDiscardMode(false);
                setNote('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        {error && <span className="text-xs text-rag-red">{error}</span>}
      </div>
    </div>
  );
}

function deriveNameFromEmail(addr: string): string {
  const local = addr.split('@')[0] ?? '';
  // Replace common separators, title-case each word. Falls back to the
  // raw local part if the heuristic produces nothing.
  const cleaned = local
    .replace(/[._\-+]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return cleaned || local;
}
