'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  resolveUnmatchedEmail,
  discardUnmatchedEmail,
  type ResolveHarvestSummary,
} from '@/server/actions/inbound-email';
import { CompanyPickerCombobox } from './CompanyPickerCombobox';

export function ResolveActions({
  unmatchedId,
  fromEmail,
}: {
  unmatchedId: string;
  /** Sender address — used only in the small explainer text next to
   *  the picker. The domain-scoped harvest reads all From / To / CC
   *  addresses from the unmatched row server-side, not from this
   *  prop. */
  fromEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [note, setNote] = useState('');
  const [discardMode, setDiscardMode] = useState(false);
  const [harvest, setHarvest] = useState<ResolveHarvestSummary | null>(null);

  function resolve() {
    if (!companyId) {
      setError('Pick a company.');
      return;
    }
    setError(null);
    setHarvest(null);
    startTransition(async () => {
      const r = await resolveUnmatchedEmail(
        unmatchedId,
        companyId,
        note.trim() || null,
      );
      if (r.error) {
        setError(r.error);
        return;
      }
      setHarvest(r.harvest ?? null);
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
          <CompanyPickerCombobox
            value={companyId}
            onChange={(next) => setCompanyId(next ?? '')}
            disabled={pending}
            placeholder="Type to search a company…"
          />

          <p className="text-xs2 text-agsi-darkGray">
            On resolve, external counterparty contacts on the company&rsquo;s
            domain are auto-added and flagged for completion.{' '}
            Internal <span className="font-medium">@agsi.ae</span>{' '}
            addresses (like {fromEmail.endsWith('@agsi.ae') ? fromEmail : 'anna.m@agsi.ae'})
            are never saved as contacts.
          </p>
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

      {harvest && (
        <HarvestSummary
          summary={harvest}
          companyId={companyId}
        />
      )}
    </div>
  );
}

function HarvestSummary({
  summary,
  companyId,
}: {
  summary: ResolveHarvestSummary;
  companyId: string;
}) {
  const added = summary.added.length;
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite/50 px-3 py-2 text-xs text-agsi-navy">
      <p className="font-medium">
        {added > 0
          ? `Added ${added} contact${added === 1 ? '' : 's'} to `
          : 'No new contacts added — '}
        <Link
          href={`/companies/${companyId}` as never}
          className="text-agsi-accent hover:underline"
        >
          the company
        </Link>
        {summary.counterparty_domain && (
          <>
            {' '}from <span className="font-medium">@{summary.counterparty_domain}</span>
          </>
        )}
        .
      </p>
      {summary.added.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {summary.added.map((c) => (
            <li key={c.email} className="text-xs2 text-agsi-darkGray">
              • {c.full_name} &lt;{c.email}&gt;
            </li>
          ))}
        </ul>
      )}
      {summary.learned_domain && (
        <p className="mt-1 text-xs2 text-agsi-darkGray">
          Learned the counterparty domain{' '}
          <span className="font-medium">{summary.learned_domain}</span> —
          future emails from this domain will auto-match.
        </p>
      )}
      {summary.skipped_duplicates > 0 && (
        <p className="mt-1 text-xs2 text-agsi-darkGray">
          {summary.skipped_duplicates} address
          {summary.skipped_duplicates === 1 ? '' : 'es'} were skipped as a
          duplicate at insert time.
        </p>
      )}
      {summary.reason && (
        <p className="mt-1 text-xs2 italic text-agsi-darkGray">
          {summary.reason} Complete each contact&rsquo;s name and designation on
          the company page.
        </p>
      )}
      {added > 0 && (
        <p className="mt-1 text-xs2 text-agsi-darkGray">
          Complete each contact&rsquo;s name and designation on the company
          page — they&rsquo;re flagged <strong>Needs details</strong>.
        </p>
      )}
    </div>
  );
}
