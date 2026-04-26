'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LEVELS, type Level, type Role } from '@/types/domain';
import { changeCompanyLevel, requestLevelChange } from '@/server/actions/level';
import { EvidenceUploader, type UploadedEvidence } from '@/components/domain/EvidenceUploader';

export function LevelChangeButton({
  companyId,
  companyName,
  currentLevel,
  userRole,
  isOwner,
  variant = 'inline',
}: {
  companyId: string;
  companyName: string;
  currentLevel: Level;
  userRole: Role;
  /** True when the current user is the company's owner. Admin always allowed. */
  isOwner: boolean;
  /** 'inline' renders a small text link (Pipeline cards). 'button' renders a primary button (company header / level history top). */
  variant?: 'inline' | 'button';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [evidenceFiles, setEvidenceFiles] = useState<UploadedEvidence[]>([]);

  const isAdmin = userRole === 'admin';
  const canChange = isAdmin || isOwner;

  async function onSubmit(formData: FormData) {
    setError(null);
    formData.delete('evidence_file_paths');
    for (const f of evidenceFiles) formData.append('evidence_file_paths', f.path);

    startTransition(async () => {
      const r = isAdmin ? await changeCompanyLevel(formData) : await requestLevelChange(formData);
      if (r.error) {
        setError(r.error);
      } else {
        setOpen(false);
        setEvidenceFiles([]);
        router.refresh();
      }
    });
  }

  if (!canChange) return null;

  if (!open) {
    const label = isAdmin ? 'Change level →' : 'Request level change →';
    if (variant === 'button') {
      return (
        <Button onClick={() => setOpen(true)} size="sm">
          {label}
        </Button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-agsi-accent hover:underline"
      >
        {label}
      </button>
    );
  }

  const targetOptions = LEVELS.filter((l) => l !== currentLevel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-agsi-navy/50 p-4">
      <form
        action={onSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl"
      >
        <input type="hidden" name="company_id" value={companyId} />
        <input type="hidden" name="from_level" value={currentLevel} />

        <div>
          <h3 className="text-lg font-semibold text-agsi-navy">
            {isAdmin ? 'Change level' : 'Request level change'}
          </h3>
          <p className="mt-1 text-sm text-agsi-darkGray">
            <strong>{companyName}</strong> is currently at <strong>{currentLevel}</strong>.
            {!isAdmin && ' An admin will review your request before the level moves.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Move to</label>
          <select
            name="to_level"
            required
            defaultValue={targetOptions[0]}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {targetOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-agsi-darkGray">
            Forward moves credit the current owner; backward moves are recorded but
            uncredited.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            Evidence note <span className="text-rag-red">*</span>
          </label>
          <textarea
            name="evidence_note"
            required
            rows={3}
            placeholder="What progressed this stakeholder? (e.g. 'Signed MOU on 25 Mar; copy attached.')"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-agsi-darkGray">
            Evidence files {isAdmin ? '(optional)' : '— add at least one screenshot/PDF'}
          </label>
          <EvidenceUploader
            companyId={companyId}
            onChange={setEvidenceFiles}
            disabled={pending}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? 'Saving…'
              : isAdmin
                ? 'Confirm change'
                : 'Submit for approval'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setEvidenceFiles([]);
            }}
          >
            Cancel
          </Button>
          {error && <p className="text-xs text-rag-red">{error}</p>}
        </div>
      </form>
    </div>
  );
}
