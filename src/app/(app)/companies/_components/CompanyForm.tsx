'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import type { Role } from '@/types/domain';
import { createCompany, updateCompany } from '@/server/actions/companies';

type Mode = 'create' | 'edit';

export type CompanyInitial = {
  id?: string;
  canonical_name: string;
  company_type: (typeof COMPANY_TYPES)[number];
  country: string | null;
  location_id: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  key_contact_name: string | null;
  key_contact_role: string | null;
  key_contact_email: string | null;
  key_contact_phone: string | null;
  notes_internal: string | null;
  is_key_stakeholder: boolean;
  owner_id: string | null;
};

export type ProfileOption = { id: string; full_name: string; role: string };

// Single source of truth for the Country → Emirate cascade. Sourced
// from city_lookup at request time and passed in here. Only the
// canonical emirate-level rows (one per emirate) populate the dropdown.
export type LocationOption = {
  id: string;
  country: string;
  emirate: string;
};

const EMPTY: CompanyInitial = {
  canonical_name: '',
  company_type: 'developer',
  country: 'United Arab Emirates',
  location_id: null,
  city: null,
  phone: null,
  email: null,
  website: null,
  key_contact_name: null,
  key_contact_role: null,
  key_contact_email: null,
  key_contact_phone: null,
  notes_internal: null,
  is_key_stakeholder: false,
  owner_id: null,
};

export function CompanyForm({
  mode,
  initial,
  profiles,
  locations,
  editable,
  userRole,
}: {
  mode: Mode;
  initial?: CompanyInitial;
  profiles: ProfileOption[];
  locations: LocationOption[];
  editable: boolean;
  /** Caller's role. bd_manager loses the Owner Select (the only
   *  owner_id they can persist is themselves — RLS WITH CHECK pins
   *  it) and the is_key_stakeholder checkbox (locked to admin /
   *  bd_head by trigger 0069). */
  userRole: Role;
}) {
  const data = initial ?? EMPTY;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Country → Emirate cascade. Emirate options re-derive when country
  // changes; selecting a new country clears the stale emirate so we
  // never persist a mismatched FK.
  const initialCountry = data.country ?? 'United Arab Emirates';
  const [country, setCountry] = useState<string>(initialCountry);
  const [locationId, setLocationId] = useState<string>(data.location_id ?? '');
  const countries = Array.from(new Set(locations.map((l) => l.country))).sort();
  const emiratesForCountry = locations
    .filter((l) => l.country === country)
    .sort((a, b) => a.emirate.localeCompare(b.emirate));

  async function onSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result =
        mode === 'create' ? await createCompany(formData) : await updateCompany(formData);
      if (result?.error) {
        setError(result.error);
      } else if (mode === 'edit') {
        setSaved(true);
      }
    });
  }

  const ro = !editable;
  const isManager = userRole === 'bd_manager';
  const ownerLabel =
    profiles.find((p) => p.id === (data.owner_id ?? ''))?.full_name ?? 'You';

  return (
    <form action={onSubmit} className="space-y-6">
      {mode === 'edit' && data.id && <input type="hidden" name="id" value={data.id} />}

      <Section title="Identity">
        <Field label="Canonical name" required>
          <Input
            name="canonical_name"
            defaultValue={data.canonical_name}
            required
            readOnly={ro}
          />
        </Field>
        <Field label="Company type" required>
          <Select name="company_type" defaultValue={data.company_type} disabled={ro}>
            {COMPANY_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPANY_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Country">
          <Select
            name="country"
            value={country}
            disabled={ro}
            onChange={(e) => {
              setCountry(e.target.value);
              // Clear emirate when country changes — never persist a
              // (country, emirate) pair from different rows.
              setLocationId('');
            }}
          >
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Emirate">
          <Select
            name="location_id"
            value={locationId}
            disabled={ro || emiratesForCountry.length === 0}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">— Select emirate —</option>
            {emiratesForCountry.map((l) => (
              <option key={l.id} value={l.id}>
                {l.emirate}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Area / community (optional)" full>
          <Input
            name="city"
            defaultValue={data.city ?? ''}
            readOnly={ro}
            placeholder="Free-text detail — analysis groups by emirate above."
          />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone">
          <Input name="phone" type="tel" defaultValue={data.phone ?? ''} readOnly={ro} />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            defaultValue={data.email ?? ''}
            readOnly={ro}
          />
        </Field>
        <Field label="Website" full>
          <Input
            name="website"
            type="url"
            defaultValue={data.website ?? ''}
            placeholder="https://"
            readOnly={ro}
          />
        </Field>
      </Section>

      <Section title="Key contact">
        <Field label="Name">
          <Input
            name="key_contact_name"
            defaultValue={data.key_contact_name ?? ''}
            readOnly={ro}
          />
        </Field>
        <Field label="Role">
          <Input
            name="key_contact_role"
            defaultValue={data.key_contact_role ?? ''}
            readOnly={ro}
          />
        </Field>
        <Field label="Email">
          <Input
            name="key_contact_email"
            type="email"
            defaultValue={data.key_contact_email ?? ''}
            readOnly={ro}
          />
        </Field>
        <Field label="Phone">
          <Input
            name="key_contact_phone"
            type="tel"
            defaultValue={data.key_contact_phone ?? ''}
            readOnly={ro}
          />
        </Field>
      </Section>

      <Section title="Ownership & flags">
        <Field label="Owner (BDM)">
          {isManager ? (
            <>
              {/* Owner is read-only for bd_manager. RLS WITH CHECK pins
                  owner_id = self on any UPDATE; persisting a different
                  value would silently reject. Hidden input preserves
                  the current value through the round-trip. */}
              <input
                type="hidden"
                name="owner_id"
                value={data.owner_id ?? ''}
              />
              <p className="mt-1 rounded-lg border border-agsi-lightGray bg-agsi-offWhite px-3 py-2 text-sm text-agsi-darkGray">
                {ownerLabel}
              </p>
            </>
          ) : (
            <Select name="owner_id" defaultValue={data.owner_id ?? ''} disabled={ro}>
              <option value="">— Unassigned —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.role})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!isManager && (
          <Field label="Key stakeholder">
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-agsi-navy">
              <input
                type="checkbox"
                name="is_key_stakeholder"
                defaultChecked={data.is_key_stakeholder}
                disabled={ro}
                className="h-4 w-4 rounded border-agsi-midGray"
              />
              Surfaces in leadership reports
            </label>
          </Field>
        )}
        {isManager && data.is_key_stakeholder && (
          // Preserve the existing flag so a bd_manager edit doesn't
          // silently un-flag a stakeholder an admin marked. The 0069
          // trigger blocks any change attempt; this just keeps the
          // current value true on round-trip.
          <input type="hidden" name="is_key_stakeholder" value="on" />
        )}
      </Section>

      <Section title="Internal notes">
        <Field label="Notes" full>
          <Textarea
            name="notes_internal"
            defaultValue={data.notes_internal ?? ''}
            rows={4}
            readOnly={ro}
          />
        </Field>
      </Section>

      {editable && (
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create company' : 'Save changes'}
          </Button>
          {error && <p className="text-xs text-rag-red">{error}</p>}
          {saved && <p className="text-xs text-agsi-green">Saved.</p>}
        </div>
      )}
      {!editable && (
        <p className="text-xs text-agsi-darkGray">
          You don&apos;t have permission to edit this company.
        </p>
      )}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-agsi-lightGray bg-white p-5">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-agsi-darkGray">
        {title}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-agsi-darkGray">
        {label}
        {required && <span className="ml-0.5 text-rag-red">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
