'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { requestCompanyGroup } from '@/server/actions/groups';

type CompanyOption = {
  id: string;
  canonical_name: string;
  parent_company_id: string | null;
};

/**
 * Two roles depending on `seed`:
 *   - seed='parent'  → current company is the parent; pick children.
 *   - seed='child'   → current company is one of the children; pick a
 *                       parent and optionally other siblings.
 */
export function RequestGroupButton({
  companyId,
  companyName,
  seed,
  options,
  alreadyPending,
}: {
  companyId: string;
  companyName: string;
  seed: 'parent' | 'child';
  options: CompanyOption[];
  alreadyPending: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>(
    seed === 'parent' ? companyId : '',
  );
  const [picked, setPicked] = useState<Set<string>>(
    seed === 'child' ? new Set([companyId]) : new Set(),
  );
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');

  const candidates = useMemo(() => {
    // Show every active company except the parent itself. Filter to
    // top-level (parent_company_id IS NULL) when seeding child — a
    // company that's already grouped under someone else needs a
    // re-parent, which is a separate decision; surface but disable.
    const q = query.trim().toLowerCase();
    return options
      .filter((c) => c.id !== parentId)
      .filter((c) =>
        q.length === 0 ? true : c.canonical_name.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [options, parentId, query]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!parentId) {
      setError('Pick the parent (holding) company.');
      return;
    }
    const children = Array.from(picked).filter((c) => c !== parentId);
    if (children.length === 0) {
      setError('Pick at least one child company.');
      return;
    }
    startTransition(async () => {
      const r = await requestCompanyGroup({
        parent_company_id: parentId,
        child_company_ids: children,
        reason: reason.trim() || null,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setPicked(seed === 'child' ? new Set([companyId]) : new Set());
      setReason('');
      router.refresh();
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={alreadyPending}
          title={
            alreadyPending
              ? 'A grouping request is already pending for this company.'
              : undefined
          }
          className="text-xs font-medium text-agsi-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Group under holding company
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="max-h-[90vh] space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-agsi-navy">
              Request company grouping
            </Dialog.Title>
            <p className="text-sm text-agsi-darkGray">
              Children remain fully visible everywhere — this is just a
              holding-structure annotation. An admin reviews the request
              before it takes effect.
            </p>

            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Parent (holding) company
              </label>
              {seed === 'parent' ? (
                <p className="mt-1 rounded-lg border border-agsi-lightGray bg-agsi-offWhite px-3 py-2 text-sm text-agsi-darkGray">
                  {companyName}
                </p>
              ) : (
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">— Pick a parent —</option>
                  {options
                    .filter((c) => c.id !== companyId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.canonical_name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-agsi-darkGray">
                  Children to group ({picked.size} selected)
                </label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="max-w-xs"
                />
              </div>
              <ul className="mt-2 max-h-64 divide-y divide-agsi-lightGray overflow-y-auto rounded-lg border border-agsi-lightGray">
                {candidates.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-agsi-darkGray">
                    No matches.
                  </li>
                ) : (
                  candidates.map((c) => {
                    const checked = picked.has(c.id);
                    const alreadyGrouped =
                      c.parent_company_id !== null &&
                      c.parent_company_id !== parentId;
                    return (
                      <li
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 rounded border-agsi-midGray"
                        />
                        <span className="flex-1 text-agsi-navy">
                          {c.canonical_name}
                        </span>
                        {alreadyGrouped && (
                          <span className="text-xs2 text-rag-amber">
                            already grouped — admin will re-parent
                          </span>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            <div>
              <label className="block text-xs font-medium text-agsi-darkGray">
                Reason (optional)
              </label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this grouping correct?"
                className="mt-1"
              />
            </div>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="button" size="sm" onClick={submit} disabled={pending}>
                {pending ? 'Sending…' : 'Submit for review'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
