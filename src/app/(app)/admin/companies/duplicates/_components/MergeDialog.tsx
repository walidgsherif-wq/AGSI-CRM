'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import {
  mergeCompanies,
  type MergeFieldChoices,
} from '@/server/actions/merge';
import type {
  CompanySnapshot,
  PairChildCounts,
} from '../page';

type FieldKey = keyof MergeFieldChoices;

const FIELDS: Array<{ key: FieldKey; label: string; getter: (s: CompanySnapshot) => string | null | boolean }> = [
  { key: 'level',              label: 'Level',              getter: (s) => s.current_level },
  { key: 'owner_id',           label: 'Owner',              getter: (s) => Array.isArray(s.owner) ? (s.owner[0]?.full_name ?? null) : (s.owner?.full_name ?? null) },
  { key: 'phone',              label: 'Phone',              getter: (s) => s.phone },
  { key: 'email',              label: 'Email',              getter: (s) => s.email },
  { key: 'website',            label: 'Website',            getter: (s) => s.website },
  { key: 'location_id',        label: 'Location',           getter: (s) => s.location_id },
  { key: 'country',            label: 'Country',            getter: (s) => s.country },
  { key: 'is_key_stakeholder', label: 'Key stakeholder',    getter: (s) => s.is_key_stakeholder },
  { key: 'parent_company_id',  label: 'Group parent',       getter: (s) => s.parent_company_id },
];

function displayValue(v: string | null | boolean): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v || '—';
}

/**
 * Merge dialog with three concerns collapsed into one modal:
 *   1) Pick the survivor (default = left; swap button).
 *   2) For each field that differs between the two, choose which
 *      value the survivor takes.
 *   3) Show a "what will move" preview (child counts from the
 *      absorbed side) and confirm.
 *
 * Fields where both sides agree don't appear — they're not a choice.
 * Fields where one side is null and the other has a value default to
 * the non-null value.
 */
export function MergeDialog({
  open,
  onOpenChange,
  left,
  right,
  leftCounts,
  rightCounts,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  left: CompanySnapshot;
  right: CompanySnapshot;
  leftCounts: PairChildCounts;
  rightCounts: PairChildCounts;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // survivorSide: which of the two is being kept.
  const [survivorSide, setSurvivorSide] = useState<'left' | 'right'>('left');
  const survivor = survivorSide === 'left' ? left : right;
  const absorbed = survivorSide === 'left' ? right : left;
  const absorbedCounts = survivorSide === 'left' ? rightCounts : leftCounts;

  // Compute the conflict rows for the current survivor/absorbed pairing.
  // The "chosen side" starts at 'survivor' for every field.
  const conflicts = useMemo(() => {
    return FIELDS.map((f) => {
      const sv = f.getter(survivor);
      const av = f.getter(absorbed);
      const differs = sv !== av;
      return {
        key: f.key,
        label: f.label,
        survivorValue: sv,
        absorbedValue: av,
        differs,
      };
    }).filter((r) => r.differs);
  }, [survivor, absorbed]);

  // choices[key] = 'survivor' | 'absorbed'. Default: survivor wins
  // (i.e., no override sent to the RPC).
  const [choices, setChoices] = useState<Partial<Record<FieldKey, 'survivor' | 'absorbed'>>>({});

  function submit() {
    setError(null);
    // Build the RPC payload — omit keys where survivor wins (default).
    const payload: MergeFieldChoices = {};
    for (const c of conflicts) {
      const pick = choices[c.key] ?? 'survivor';
      if (pick === 'absorbed') payload[c.key] = 'absorbed';
    }
    startTransition(async () => {
      const r = await mergeCompanies({
        survivorId: survivor.id,
        absorbedId: absorbed.id,
        fieldChoices: payload,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setError(null);
          setChoices({});
          setSurvivorSide('left');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="max-h-[90vh] space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-agsi-navy">
              Merge duplicate companies
            </Dialog.Title>
            <p className="text-xs text-agsi-darkGray">
              This collapses the absorbed record into the survivor. All
              projects, engagements, notes, tasks, contacts, and level
              history from the absorbed row move to the survivor. The
              absorbed row is hidden from every list; it&rsquo;s not
              deleted. Reversible via un-merge (Build 3).
            </p>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
                Survivor (keep this record)
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SurvivorPickCard
                  side="left"
                  active={survivorSide === 'left'}
                  onClick={() => setSurvivorSide('left')}
                  snapshot={left}
                />
                <SurvivorPickCard
                  side="right"
                  active={survivorSide === 'right'}
                  onClick={() => setSurvivorSide('right')}
                  snapshot={right}
                />
              </div>
            </div>

            {conflicts.length === 0 ? (
              <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite/40 p-3 text-xs text-agsi-darkGray">
                No conflicting fields — the survivor keeps every value it
                already has and just absorbs the child rows.
              </div>
            ) : (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
                  Resolve conflicts ({conflicts.length})
                </p>
                <div className="divide-y divide-agsi-lightGray rounded-lg border border-agsi-lightGray">
                  {conflicts.map((c) => {
                    const pick = choices[c.key] ?? 'survivor';
                    return (
                      <div key={c.key} className="grid grid-cols-[1fr_auto_1fr] gap-3 px-3 py-2 text-xs">
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`choice-${c.key}`}
                            checked={pick === 'survivor'}
                            onChange={() => setChoices((cur) => ({ ...cur, [c.key]: 'survivor' }))}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium text-agsi-navy">
                              {c.label}: {displayValue(c.survivorValue)}
                            </span>
                            <span className="text-xxs text-agsi-darkGray">(survivor)</span>
                          </span>
                        </label>
                        <span className="self-center text-agsi-darkGray">vs</span>
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`choice-${c.key}`}
                            checked={pick === 'absorbed'}
                            onChange={() => setChoices((cur) => ({ ...cur, [c.key]: 'absorbed' }))}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium text-agsi-navy">
                              {c.label}: {displayValue(c.absorbedValue)}
                            </span>
                            <span className="text-xxs text-agsi-darkGray">(absorbed)</span>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-agsi-amber/40 bg-agsi-amber/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-agsi-darkGray">
                What will move to {survivor.canonical_name}
              </p>
              <p className="mt-1 text-xs text-agsi-navy">
                From {absorbed.canonical_name}:{' '}
                <strong className="tabular-nums">{absorbedCounts.projects}</strong> projects,{' '}
                <strong className="tabular-nums">{absorbedCounts.engagements}</strong> engagements,{' '}
                <strong className="tabular-nums">{absorbedCounts.contacts}</strong> contacts,{' '}
                <strong className="tabular-nums">{absorbedCounts.levelHistory}</strong> level events.
              </p>
            </div>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="button" size="sm" variant="danger" disabled={pending} onClick={submit}>
                {pending ? 'Merging…' : `Merge into ${survivor.canonical_name}`}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SurvivorPickCard({
  active,
  onClick,
  snapshot,
}: {
  side: 'left' | 'right';
  active: boolean;
  onClick: () => void;
  snapshot: CompanySnapshot;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-lg border-2 border-agsi-navy bg-agsi-offWhite/40 p-3 text-left'
          : 'rounded-lg border border-agsi-lightGray bg-white p-3 text-left hover:border-agsi-midGray'
      }
    >
      <p className="text-sm font-medium text-agsi-navy">
        {snapshot.canonical_name}
      </p>
      <p className="mt-1 text-xxs text-agsi-darkGray">
        {snapshot.current_level} · {snapshot.country ?? 'no country'}
      </p>
    </button>
  );
}
