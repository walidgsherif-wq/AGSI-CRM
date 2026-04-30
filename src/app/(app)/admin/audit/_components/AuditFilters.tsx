'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

const EVENT_TYPE_LABEL: Record<string, string> = {
  level_change: 'Level change',
  level_change_approval: 'Level change approval',
  ownership_transfer: 'Ownership transfer',
  credit_auto_dedup: 'Credit auto-dedup',
  engagement_delete: 'Engagement delete',
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  company: 'Company',
  engagement: 'Engagement',
  level_change_request: 'Level change request',
  level_history: 'Level history',
};

type Actor = { id: string; full_name: string; role: string };

type Props = {
  initialEventType: string;
  initialEntityType: string;
  initialActor: string;
  initialFrom: string;
  initialTo: string;
  actors: Actor[];
  eventTypes: string[];
  entityTypes: string[];
};

export function AuditFilters({
  initialEventType,
  initialEntityType,
  initialActor,
  initialFrom,
  initialTo,
  actors,
  eventTypes,
  entityTypes,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(next: Partial<{
    type: string;
    entity: string;
    actor: string;
    from: string;
    to: string;
  }>) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('page'); // any filter change resets to page 1
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || v === 'all' || v === undefined) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`/admin/audit?${sp.toString()}` as never);
  }

  function clear() {
    router.push('/admin/audit' as never);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Select
        label="Event type"
        value={initialEventType}
        onChange={(v) => update({ type: v })}
      >
        <option value="all">All</option>
        {eventTypes.map((t) => (
          <option key={t} value={t}>
            {EVENT_TYPE_LABEL[t] ?? t}
          </option>
        ))}
      </Select>
      <Select
        label="Entity type"
        value={initialEntityType}
        onChange={(v) => update({ entity: v })}
      >
        <option value="all">All</option>
        {entityTypes.map((t) => (
          <option key={t} value={t}>
            {ENTITY_TYPE_LABEL[t] ?? t}
          </option>
        ))}
      </Select>
      <Select
        label="Actor"
        value={initialActor}
        onChange={(v) => update({ actor: v })}
      >
        <option value="all">All actors</option>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name} ({a.role})
          </option>
        ))}
      </Select>
      <Date
        label="From"
        value={initialFrom}
        onChange={(v) => update({ from: v })}
      />
      <div className="flex flex-col gap-1">
        <Date label="To" value={initialTo} onChange={(v) => update({ to: v })} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={clear}
          className="self-start"
        >
          Clear all
        </Button>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}

function Date({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs font-medium text-agsi-darkGray">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
      />
    </label>
  );
}
