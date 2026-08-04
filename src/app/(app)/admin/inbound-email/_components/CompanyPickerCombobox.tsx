'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import {
  searchCompaniesForResolver,
  type CompanySearchHit,
} from '@/server/actions/companies-search';

const DEBOUNCE_MS = 250;

/**
 * Type-to-search company picker for the inbound-email resolver.
 * Server-side ilike (via searchCompaniesForResolver) so any of the
 * ~3.6k active, non-merged companies is reachable — replaces the old
 * capped alphabetical <select>.
 *
 * Each row shows name + type + emirate so two similarly-named entities
 * are distinguishable at a glance.
 *
 * Emits `onChange(companyId | null)` — parent form owns the state.
 */
export function CompanyPickerCombobox({
  value,
  onChange,
  disabled,
  placeholder = 'Type to search…',
  initialSelected = null,
}: {
  value: string;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Pre-hydrated hit for the chip when `value` is set on first render
   *  (e.g. from URL params) — avoids a client round-trip just to show
   *  the label. Consumers who don't need this can leave it null. */
  initialSelected?: CompanySearchHit | null;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompanySearchHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<CompanySearchHit | null>(
    initialSelected,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useRef(
    `company-lb-${Math.random().toString(36).slice(2, 8)}`,
  ).current;

  // Clear our internal selection whenever the parent nulls out `value`
  // (e.g. after a successful resolve() the parent resets its state).
  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  // Debounced fetch. Cancels via a per-effect flag rather than aborting
  // the server action itself (server actions don't accept AbortSignals);
  // stale results just get discarded before landing in state.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchCompaniesForResolver(q).then((hits) => {
        if (cancelled) return;
        setResults(hits);
        setHighlight(0);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = useCallback(
    (hit: CompanySearchHit) => {
      setSelected(hit);
      setQuery('');
      setResults([]);
      setOpen(false);
      onChange(hit.id);
    },
    [onChange],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[highlight];
      if (hit) pick(hit);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // When a value is already selected, show a chip with a change/clear
  // affordance. Simpler than mixing the display in with the input.
  if (selected) {
    return (
      <div ref={rootRef} className="w-full">
        <div className="flex items-center gap-2 rounded border border-agsi-midGray bg-white px-2 py-1 text-xs">
          <div className="flex-1">
            <div className="font-medium text-agsi-navy">
              {selected.canonical_name}
            </div>
            <div className="text-xxs text-agsi-darkGray">
              {COMPANY_TYPE_LABEL[selected.company_type]}
              {selected.emirate ? ` · ${selected.emirate}` : ''}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setSelected(null);
              onChange(null);
              // Focus the input on the next tick so the user can type
              // immediately after clearing.
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="text-xs2 text-agsi-darkGray hover:text-rag-red hover:underline disabled:opacity-50"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
      />

      {open && query.trim().length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-agsi-lightGray bg-white shadow-lg"
        >
          {loading ? (
            <p className="px-3 py-2 text-xs text-agsi-darkGray">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs italic text-agsi-darkGray">
              No matches.
            </p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(r)}
                    className={
                      i === highlight
                        ? 'block w-full px-3 py-2 text-left text-xs bg-agsi-offWhite'
                        : 'block w-full px-3 py-2 text-left text-xs hover:bg-agsi-offWhite'
                    }
                  >
                    <div className="font-medium text-agsi-navy">
                      {r.canonical_name}
                    </div>
                    <div className="text-xxs text-agsi-darkGray">
                      {COMPANY_TYPE_LABEL[r.company_type]}
                      {r.emirate ? ` · ${r.emirate}` : ' · no emirate'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
