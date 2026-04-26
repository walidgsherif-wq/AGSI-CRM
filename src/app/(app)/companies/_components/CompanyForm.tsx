'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { COMPANY_TYPES, COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { createCompany, updateCompany } from '@/server/actions/companies';

type Mode = 'create' | 'edit';

export type CompanyInitial = {
  id?: string;
  canonical_name: string;
  company_type: (typeof COMPANY_TYPES)[number];
  country: string | null;
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

const EMPTY: CompanyInitial = {
  canonical_name: '',
  company_type: 'developer',
  country: 'United Arab Emirates',
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
  editable,
}: {
  mode: Mode;
  initial?: CompanyInitial;
  profiles: ProfileOption[];
  editable: boolean;
}) {
  const data = initial ?? EMPTY;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  return (
    <form action={onSubmit} className="space-y-6">
      {mode === 'edit' && data.id && <input type="hidden" name="id" value={data.id} />}

      <Section title="Identity">
        <Field label="Canonical name" required>
          <input
            name="canonical_name"
            defaultValue={data.canonical_name}
            required
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Company type" required>
          <select
            name="company_type"
            defaultValue={data.company_type}
            disabled={ro}
            className={inputClass(ro)}
          >
            {COMPANY_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPANY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Country">
          <input
            name="country"
            defaultValue={data.country ?? 'United Arab Emirates'}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="City">
          <input
            name="city"
            defaultValue={data.city ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone">
          <input
            name="phone"
            type="tel"
            defaultValue={data.phone ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            defaultValue={data.email ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Website" full>
          <input
            name="website"
            type="url"
            defaultValue={data.website ?? ''}
            placeholder="https://"
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      <Section title="Key contact">
        <Field label="Name">
          <input
            name="key_contact_name"
            defaultValue={data.key_contact_name ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Role">
          <input
            name="key_contact_role"
            defaultValue={data.key_contact_role ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Email">
          <input
            name="key_contact_email"
            type="email"
            defaultValue={data.key_contact_email ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Phone">
          <input
            name="key_contact_phone"
            type="tel"
            defaultValue={data.key_contact_phone ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      <Section title="Ownership & flags">
        <Field label="Owner (BDM)">
          <select
            name="owner_id"
            defaultValue={data.owner_id ?? ''}
            disabled={ro}
            className={inputClass(ro)}
          >
            <option value="">— Unassigned —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.role})
              </option>
            ))}
          </select>
        </Field>
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
      </Section>

      <Section title="Internal notes">
        <Field label="Notes" full>
          <textarea
            name="notes_internal"
            defaultValue={data.notes_internal ?? ''}
            rows={4}
            readOnly={ro}
            className={inputClass(ro)}
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

function inputClass(readOnly: boolean) {
  return [
    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-agsi-navy',
    'border-agsi-midGray placeholder:text-agsi-midGray',
    readOnly
      ? 'cursor-not-allowed bg-agsi-lightGray/40 text-agsi-darkGray'
      : 'focus:border-agsi-accent focus:outline-none focus:ring-1 focus:ring-agsi-accent',
  ].join(' ');
}
