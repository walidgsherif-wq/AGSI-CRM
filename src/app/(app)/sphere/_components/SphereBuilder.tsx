'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Lock, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  addToSphere,
  removeFromSphere,
  type SphereBuilderResponse,
  type SphereBuilderRow,
} from '@/server/actions/sphere';
import { proposeForSphere } from '@/server/actions/sphere-proposals';
import {
  PAGE_SIZE,
  SPHERE_IN_FILTERS,
  type SphereQuery,
  type SphereSortDir,
  type SphereSortKey,
} from '@/lib/zod/sphere';

const AED = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const NUM = new Intl.NumberFormat();

export function SphereBuilder({
  initialData,
  initialQuery,
  typeOptions,
  currentUserId,
  currentUserRole,
  canEdit,
}: {
  initialData: SphereBuilderResponse;
  initialQuery: SphereQuery;
  typeOptions: Array<{ value: string; label: string }>;
  currentUserId: string;
  currentUserRole: 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Row selection is UI-local; nothing needs to persist across
  // navigation. A Set keyed by company_id is O(1) for the toggle-all
  // + bulk-action paths.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{
    tone: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  const rows = initialData.rows;
  const totalPages = Math.max(1, Math.ceil(initialData.total / PAGE_SIZE));

  // Amendment (0098): removal is admin/bd_head only.
  const canRemove =
    currentUserRole === 'admin' || currentUserRole === 'bd_head';
  const canAddDirectly = canRemove; // same tier
  const canPropose = currentUserRole === 'bd_manager';

  // Silence "unused prop" for the current user id — kept in the API
  // shape because a future per-user proposal history view will want it.
  void currentUserId;

  // URL-driven state. Merge overrides into the current search params
  // and push. Clearing a value = drop that key from the URL.
  function pushQuery(patch: Partial<Record<string, string | null>>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === undefined) next.delete(k);
      else next.set(k, v);
    }
    // Changing any filter resets to page 1 unless the patch itself
    // sets `page` explicitly.
    if (!('page' in patch)) next.delete('page');
    startTransition(() => {
      // Next 14 typedRoutes rejects template-literal URLs — the target
      // is dynamic-by-design (search params), cast to satisfy the
      // route type without loosening the router surface.
      router.push(`${pathname}?${next.toString()}` as never);
    });
    // Selection stays valid across page changes but stale rows won't
    // render — bulk action naturally ignores what isn't in the DOM.
  }

  function toggleSort(key: SphereSortKey) {
    const currentKey = initialQuery.sort;
    const currentDir = initialQuery.dir;
    const nextDir: SphereSortDir =
      currentKey === key ? (currentDir === 'desc' ? 'asc' : 'desc') : 'desc';
    pushQuery({ sort: key, dir: nextDir });
  }

  function toggleRow(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAllOnPage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (on) next.add(r.company_id);
        else next.delete(r.company_id);
      }
      return next;
    });
  }

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.company_id)),
    [rows, selected],
  );
  // "Addable" set = out-of-sphere companies. Admins add directly.
  // Managers propose — same eligibility, but a pending / rejected
  // proposal disqualifies (server will dedup anyway; the UI hint
  // stops a manager wasting a click).
  const selectableAdd = selectedRows.filter(
    (r) => !r.in_sphere && !r.pending_proposal_id && !r.rejected_proposal_id,
  );
  const selectableRemove = selectedRows.filter((r) => r.in_sphere);

  function bulkAdd() {
    if (selectableAdd.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await addToSphere(selectableAdd.map((r) => r.company_id));
      if ('error' in res) {
        setMsg({ tone: 'err', text: res.error });
        return;
      }
      setMsg({
        tone: 'ok',
        text: `${res.added} added to sphere.`,
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkPropose() {
    if (selectableAdd.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const results = await Promise.all(
        selectableAdd.map((r) =>
          proposeForSphere(r.company_id, 'manual'),
        ),
      );
      let proposed = 0;
      let deduped = 0;
      let errored = 0;
      for (const r of results) {
        if ('error' in r) errored += 1;
        else if (r.proposed) proposed += 1;
        else deduped += 1;
      }
      const parts: string[] = [];
      if (proposed > 0) parts.push(`${proposed} proposed for review.`);
      if (deduped > 0) parts.push(`${deduped} skipped (already covered or pending).`);
      if (errored > 0) parts.push(`${errored} failed.`);
      setMsg({
        tone: errored > 0 ? 'err' : deduped > 0 ? 'warn' : 'ok',
        text: parts.join(' ') || 'Nothing to propose.',
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkRemove() {
    if (selectableRemove.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await removeFromSphere(
        selectableRemove.map((r) => r.company_id),
      );
      if ('error' in res) {
        setMsg({ tone: 'err', text: res.error });
        return;
      }
      setMsg({ tone: 'ok', text: `${res.removed} removed.` });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="grid gap-2 border-b border-agsi-lightGray/60 p-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="block text-xxs font-medium uppercase tracking-wider text-agsi-darkGray">
            Search
          </label>
          <form
            action=""
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get('q');
              pushQuery({ q: typeof v === 'string' && v.trim() ? v.trim() : null });
            }}
          >
            <Input
              name="q"
              placeholder="Company name…"
              defaultValue={initialQuery.q ?? ''}
              className="mt-1"
            />
          </form>
        </div>
        <div>
          <label className="block text-xxs font-medium uppercase tracking-wider text-agsi-darkGray">
            Type
          </label>
          <Select
            value={initialQuery.type ?? ''}
            onChange={(e) => pushQuery({ type: e.target.value || null })}
            className="mt-1"
          >
            <option value="">All types</option>
            {typeOptions.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xxs font-medium uppercase tracking-wider text-agsi-darkGray">
            City
          </label>
          <Select
            value={initialQuery.city ?? ''}
            onChange={(e) => pushQuery({ city: e.target.value || null })}
            className="mt-1"
          >
            <option value="">All cities</option>
            {initialData.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xxs font-medium uppercase tracking-wider text-agsi-darkGray">
            Owner
          </label>
          <Select
            value={initialQuery.owner ?? ''}
            onChange={(e) => pushQuery({ owner: e.target.value || null })}
            className="mt-1"
          >
            <option value="">All owners</option>
            {initialData.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xxs font-medium uppercase tracking-wider text-agsi-darkGray">
            Membership
          </label>
          <Select
            value={initialQuery.in}
            onChange={(e) =>
              pushQuery({
                in:
                  (SPHERE_IN_FILTERS as readonly string[]).includes(
                    e.target.value,
                  )
                    ? e.target.value
                    : 'all',
              })
            }
            className="mt-1"
          >
            <option value="all">All companies</option>
            <option value="in">In sphere</option>
            <option value="out">Not in sphere</option>
          </Select>
        </div>
      </div>

      {/* Bulk action bar */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 px-3">
          <span className="text-xs text-agsi-darkGray">
            {selected.size === 0
              ? canPropose
                ? 'Select rows to propose for the sphere.'
                : 'Select rows to add or remove.'
              : `${selected.size} selected`}
          </span>
          {canAddDirectly && (
            <Button
              size="sm"
              disabled={pending || selectableAdd.length === 0}
              onClick={bulkAdd}
            >
              + Add {selectableAdd.length > 0 ? selectableAdd.length : ''} to sphere
            </Button>
          )}
          {canPropose && (
            <Button
              size="sm"
              disabled={pending || selectableAdd.length === 0}
              onClick={bulkPropose}
            >
              Propose {selectableAdd.length > 0 ? selectableAdd.length : ''} for review
            </Button>
          )}
          {canRemove && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || selectableRemove.length === 0}
              onClick={bulkRemove}
            >
              − Remove {selectableRemove.length > 0 ? selectableRemove.length : ''} from sphere
            </Button>
          )}
          {msg && (
            <span
              className={`text-xs ${
                msg.tone === 'err'
                  ? 'text-rag-red'
                  : msg.tone === 'warn'
                    ? 'text-rag-amber'
                    : 'text-agsi-green'
              }`}
            >
              {msg.text}
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border-t border-agsi-lightGray/60">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-agsi-lightGray text-left text-xxs uppercase tracking-wider text-agsi-darkGray">
              {canEdit && (
                <th className="w-8 px-3 py-2">
                  <input
                    aria-label="Select all rows on this page"
                    type="checkbox"
                    checked={
                      rows.length > 0 &&
                      rows.every((r) => selected.has(r.company_id))
                    }
                    onChange={(e) => selectAllOnPage(e.target.checked)}
                  />
                </th>
              )}
              <th className="px-3 py-2">
                <HeaderSort
                  label="Name"
                  active={initialQuery.sort === 'name'}
                  dir={initialQuery.dir}
                  onClick={() => toggleSort('name')}
                />
              </th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">City</th>
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2 text-right">
                <HeaderSort
                  label="# projects"
                  active={initialQuery.sort === 'project_count'}
                  dir={initialQuery.dir}
                  onClick={() => toggleSort('project_count')}
                />
              </th>
              <th className="px-3 py-2 text-right">
                <HeaderSort
                  label="Value involved"
                  active={initialQuery.sort === 'value_involved'}
                  dir={initialQuery.dir}
                  onClick={() => toggleSort('value_involved')}
                />
              </th>
              <th className="px-3 py-2">Sphere</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 9 : 8}
                  className="p-6 text-center text-xs italic text-agsi-darkGray"
                >
                  No companies match this filter.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isSelected = selected.has(r.company_id);
                return (
                  <tr
                    key={r.company_id}
                    className={
                      isSelected
                        ? 'bg-agsi-accent/5'
                        : 'hover:bg-agsi-offWhite/50'
                    }
                  >
                    {canEdit && (
                      <td className="px-3 py-2 align-top">
                        <input
                          aria-label={`Select ${r.canonical_name}`}
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleRow(r.company_id, e.target.checked)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Link
                        href={`/companies/${r.company_id}` as never}
                        className="font-medium text-agsi-navy hover:underline"
                      >
                        {r.canonical_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-agsi-darkGray">
                      {(COMPANY_TYPE_LABEL as Record<string, string>)[
                        r.company_type
                      ] ?? r.company_type}
                    </td>
                    <td className="px-3 py-2 text-xs text-agsi-darkGray">
                      {r.city ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="neutral">{r.level}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-agsi-darkGray">
                      {r.owner_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {NUM.format(r.project_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.project_value_involved > 0
                        ? `AED ${AED.format(r.project_value_involved)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.in_sphere ? (
                        <span className="inline-flex items-center gap-1 text-xxs text-agsi-green">
                          <Check aria-hidden className="h-3 w-3" />
                          In
                        </span>
                      ) : r.pending_proposal_id ? (
                        <span
                          className="inline-flex items-center gap-1 text-xxs text-rag-amber"
                          title="Awaiting admin review"
                        >
                          <Lock aria-hidden className="h-3 w-3" />
                          Pending
                        </span>
                      ) : r.rejected_proposal_id ? (
                        <span
                          className="inline-flex items-center gap-1 text-xxs italic text-agsi-darkGray"
                          title="Previously rejected — admin can still add manually"
                        >
                          <X aria-hidden className="h-3 w-3" />
                          Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xxs text-agsi-darkGray">
                          <X aria-hidden className="h-3 w-3" />
                          Out
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-agsi-lightGray/60 p-3 text-xs text-agsi-darkGray">
        <span>
          {initialData.total === 0
            ? '0 companies'
            : `Showing ${(initialData.page - 1) * PAGE_SIZE + 1}-${Math.min(
                initialData.page * PAGE_SIZE,
                initialData.total,
              )} of ${NUM.format(initialData.total)}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || initialData.page <= 1}
            onClick={() =>
              pushQuery({ page: String(Math.max(1, initialData.page - 1)) })
            }
          >
            Previous
          </Button>
          <span>
            Page {initialData.page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || initialData.page >= totalPages}
            onClick={() =>
              pushQuery({
                page: String(Math.min(totalPages, initialData.page + 1)),
              })
            }
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeaderSort({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SphereSortDir;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-wider ${
        active
          ? 'text-agsi-navy'
          : 'text-agsi-darkGray hover:text-agsi-navy'
      }`}
    >
      {label}
      {active ? (
        dir === 'desc' ? (
          <ArrowDown aria-hidden className="h-3 w-3" />
        ) : (
          <ArrowUp aria-hidden className="h-3 w-3" />
        )
      ) : null}
    </button>
  );
}

