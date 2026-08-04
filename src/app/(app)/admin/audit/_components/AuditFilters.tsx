'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CompanyPickerCombobox } from '../../inbound-email/_components/CompanyPickerCombobox';
import type { CompanySearchHit } from '@/server/actions/companies-search';

// Keep aligned with ALL_EVENT_TYPES in page.tsx. Adding an entry to the
// page list without adding the label here just shows the raw string.
const EVENT_TYPE_LABEL: Record<string, string> = {
  app_setting_change: 'App setting change',
  company_claimed: 'Company claimed',
  company_group_approved: 'Group approved',
  company_merged: 'Company merged',
  company_unclaimed: 'Company unclaimed',
  contact_archived: 'Contact archived',
  contact_created: 'Contact created',
  contact_purged: 'Contact purged',
  contact_restored: 'Contact restored',
  contact_updated: 'Contact updated',
  credit_auto_dedup: 'Credit auto-dedup',
  ecosystem_point_change: 'Point value change',
  engagement_delete: 'Engagement delete',
  feature_access_change: 'Feature access change',
  level_change: 'Level change',
  level_change_approval: 'Level change approval',
  level_initial_backfill: 'Initial level backfill',
  ownership_transfer: 'Ownership transfer',
  stagnation_rule_change: 'Stagnation rule change',
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  app_setting: 'App setting',
  company: 'Company',
  contact: 'Contact',
  ecosystem_point_scale: 'Ecosystem point',
  engagement: 'Engagement',
  feature_access: 'Feature access',
  level_change_request: 'Level change request',
  level_history: 'Level history',
  stagnation_rule: 'Stagnation rule',
};

type Actor = { id: string; full_name: string; role: string };

type Props = {
  initialEventType: string;
  initialEntityType: string;
  initialActor: string;
  initialCompany: string;
  initialCompanyHit: CompanySearchHit | null;
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
  initialCompany,
  initialCompanyHit,
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
    company: string;
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
    <div className="space-y-3">
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
      <div className="max-w-sm">
        <label className="mb-1 block text-xs font-medium text-agsi-darkGray">
          Company
        </label>
        {/* Type-to-search picker — same server-side ilike lookup used by
            the inbound-email resolver. Scopes the log to events where
            the selected stakeholder is the entity: claims, transfers,
            merges, level changes, group approvals. */}
        <CompanyPickerCombobox
          value={initialCompany}
          initialSelected={initialCompanyHit}
          onChange={(id) => update({ company: id ?? '' })}
          placeholder="Filter to a stakeholder…"
        />
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
