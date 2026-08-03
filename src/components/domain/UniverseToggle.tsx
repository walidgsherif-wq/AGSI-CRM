'use client';

import type { Universe } from '@/types/coverage';

/**
 * Sphere / Full-universe segmented control. Mirrors the value-band
 * chip row so panels can pair the two axes without a bespoke layout
 * per panel. Default 'sphere' matches every metric action's default.
 *
 * Pure presentational — the caller owns the state so the same
 * control can drive a URL param, a shared event bus, or component-
 * local state.
 */
export function UniverseToggle({
  value,
  onChange,
  disabled,
  size = 'sm',
}: {
  value: Universe;
  onChange: (next: Universe) => void;
  disabled?: boolean;
  size?: 'sm' | 'xs';
}) {
  const sizeCls =
    size === 'xs'
      ? 'px-2 py-0.5 text-xxs'
      : 'px-3 py-1 text-xs';
  const options: Array<{ value: Universe; label: string }> = [
    { value: 'sphere', label: 'Sphere' },
    { value: 'full', label: 'Full universe' },
  ];
  return (
    <div
      className="inline-flex rounded border border-agsi-midGray bg-white p-0.5"
      role="tablist"
      aria-label="Universe scope"
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`rounded ${sizeCls} font-medium transition-colors ${
              active
                ? 'bg-agsi-navy text-white'
                : 'text-agsi-navy hover:bg-agsi-lightGray/40'
            } ${disabled ? 'opacity-50' : ''}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Universe-aware denominator label. "78 of 250 (sphere)" vs
 * "78 of 3,616 (full universe)". Used across all four panels so
 * nobody misreads a sphere percentage as universe coverage.
 */
export function universeSuffix(universe: Universe): string {
  return universe === 'sphere' ? '(sphere)' : '(full universe)';
}

export function SphereFallbackNotice() {
  return (
    <div className="mb-3 rounded border border-agsi-lightGray bg-agsi-offWhite/60 px-3 py-2 text-xs text-agsi-darkGray">
      No sphere defined yet — showing the full universe. Define
      targets on{' '}
      <a
        href="/sphere"
        className="font-medium text-agsi-accent hover:underline"
      >
        /sphere
      </a>
      .
    </div>
  );
}
