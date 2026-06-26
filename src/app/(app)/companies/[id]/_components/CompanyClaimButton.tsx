'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { claimCompany } from '@/server/actions/companies';
import type { LocationOption } from '../../_components/CompanyForm';

/**
 * Banner above the Details card when a stakeholder is unowned and the
 * viewer is allowed to claim (admin / bd_head / bd_manager). Clicking
 * "Claim" opens a small modal that asks for Country (defaults UAE)
 * and Emirate — both required by the claim_company RPC (0077) so the
 * stakeholder appears on the map and can be progressed immediately.
 */
export function CompanyClaimButton({
  companyId,
  locations,
}: {
  companyId: string;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const countries = useMemo(
    () => Array.from(new Set(locations.map((l) => l.country))).sort(),
    [locations],
  );
  const [country, setCountry] = useState<string>(
    countries[0] ?? 'United Arab Emirates',
  );
  const [locationId, setLocationId] = useState<string>('');

  const emiratesForCountry = useMemo(
    () =>
      locations
        .filter((l) => l.country === country)
        .sort((a, b) => a.emirate.localeCompare(b.emirate)),
    [locations, country],
  );

  function onSubmit() {
    setError(null);
    if (!locationId) {
      setError('Select an emirate.');
      return;
    }
    startTransition(async () => {
      const r = await claimCompany(companyId, locationId);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-agsi-accent/40 bg-agsi-accent/5 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-agsi-navy">
            This stakeholder is unowned.
          </p>
          <p className="text-xs text-agsi-darkGray">
            Claim it to assign yourself as owner. Pick an emirate so the
            stakeholder appears on the map and can be progressed.
          </p>
        </div>
        <Dialog.Trigger asChild>
          <Button disabled={pending}>Claim this company</Button>
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="space-y-4 rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold text-agsi-navy">
              Claim this stakeholder
            </Dialog.Title>
            <p className="text-sm text-agsi-darkGray">
              You’ll become the owner and gain full edit access. Pick the
              stakeholder’s emirate so it shows on the map immediately.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Country
                </span>
                <Select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setLocationId('');
                  }}
                  disabled={pending}
                >
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-agsi-darkGray">
                  Emirate <span className="text-rag-red">*</span>
                </span>
                <Select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  disabled={pending || emiratesForCountry.length === 0}
                  required
                >
                  <option value="">— Select emirate —</option>
                  {emiratesForCountry.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.emirate}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {error && <p className="text-xs text-rag-red">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" size="sm" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                size="sm"
                onClick={onSubmit}
                disabled={pending || !locationId}
              >
                {pending ? 'Claiming…' : 'Claim'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
