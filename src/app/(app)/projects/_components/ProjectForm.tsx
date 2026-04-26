'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABEL,
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABEL,
} from '@/lib/zod/project';
import { createProject, updateProject } from '@/server/actions/projects';

type Mode = 'create' | 'edit';

export type ProjectInitial = {
  id?: string;
  name: string;
  project_type: string | null;
  stage: (typeof PROJECT_STAGES)[number];
  value_aed: number | null;
  value_usd: number | null;
  city: string | null;
  location: string | null;
  sector: string | null;
  industry: string | null;
  estimated_completion_date: string | null;
  completion_percentage: number | null;
  agsi_priority: (typeof PROJECT_PRIORITIES)[number] | null;
  agsi_internal_notes: string | null;
};

const EMPTY: ProjectInitial = {
  name: '',
  project_type: null,
  stage: 'concept',
  value_aed: null,
  value_usd: null,
  city: null,
  location: null,
  sector: null,
  industry: null,
  estimated_completion_date: null,
  completion_percentage: null,
  agsi_priority: null,
  agsi_internal_notes: null,
};

export function ProjectForm({
  mode,
  initial,
  editable,
}: {
  mode: Mode;
  initial?: ProjectInitial;
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
        mode === 'create' ? await createProject(formData) : await updateProject(formData);
      if (result?.error) setError(result.error);
      else if (mode === 'edit') setSaved(true);
    });
  }

  const ro = !editable;

  return (
    <form action={onSubmit} className="space-y-6">
      {mode === 'edit' && data.id && <input type="hidden" name="id" value={data.id} />}

      <Section title="Identity">
        <Field label="Project name" required full>
          <input
            name="name"
            defaultValue={data.name}
            required
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Type">
          <input
            name="project_type"
            defaultValue={data.project_type ?? ''}
            placeholder="Retail, Mixed-use, …"
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Stage" required>
          <select
            name="stage"
            defaultValue={data.stage}
            disabled={ro}
            className={inputClass(ro)}
          >
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Location">
        <Field label="City">
          <input
            name="city"
            defaultValue={data.city ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Location detail">
          <input
            name="location"
            defaultValue={data.location ?? ''}
            placeholder="Neighbourhood, plot, …"
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Sector">
          <input
            name="sector"
            defaultValue={data.sector ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Industry">
          <input
            name="industry"
            defaultValue={data.industry ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      <Section title="Value & timing">
        <Field label="Value (AED)">
          <input
            name="value_aed"
            type="number"
            min={0}
            step="0.01"
            defaultValue={data.value_aed ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Value (USD)">
          <input
            name="value_usd"
            type="number"
            min={0}
            step="0.01"
            defaultValue={data.value_usd ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Est. completion date">
          <input
            name="estimated_completion_date"
            type="date"
            defaultValue={data.estimated_completion_date ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
        <Field label="Completion %">
          <input
            name="completion_percentage"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={data.completion_percentage ?? ''}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      <Section title="AGSI internal">
        <Field label="Priority">
          <select
            name="agsi_priority"
            defaultValue={data.agsi_priority ?? ''}
            disabled={ro}
            className={inputClass(ro)}
          >
            <option value="">— None —</option>
            {PROJECT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PROJECT_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Internal notes" full>
          <textarea
            name="agsi_internal_notes"
            defaultValue={data.agsi_internal_notes ?? ''}
            rows={4}
            readOnly={ro}
            className={inputClass(ro)}
          />
        </Field>
      </Section>

      {editable && (
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create project' : 'Save changes'}
          </Button>
          {error && <p className="text-xs text-rag-red">{error}</p>}
          {saved && <p className="text-xs text-agsi-green">Saved.</p>}
        </div>
      )}
      {!editable && (
        <p className="text-xs text-agsi-darkGray">
          You don&apos;t have permission to edit this project.
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
