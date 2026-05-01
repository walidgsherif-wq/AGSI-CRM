'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { updateFiscalYearStartMonth } from '@/server/actions/admin-settings';
import { SaveBar } from './SaveBar';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function FiscalYearCard({ initialMonth }: { initialMonth: number }) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);
  const dirty = month !== initialMonth;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiscal year</CardTitle>
        <CardDescription>
          Which calendar month starts the fiscal year. Affects every quarter
          calculation across KPIs, BEI, and reports. Default per §16 D-1: Jan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Start month
        </label>
        <select
          value={month}
          onChange={(e) => {
            setMonth(Number(e.target.value));
            setStatus(null);
          }}
          className="mt-1 w-48 rounded-lg border border-agsi-midGray bg-white px-3 py-1.5 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <SaveBar
          pending={pending}
          dirty={dirty}
          status={status}
          onSave={() => {
            setStatus(null);
            startTransition(async () => {
              const r = await updateFiscalYearStartMonth(month);
              if ('error' in r) setStatus({ error: r.error });
              else {
                setStatus({ ok: true });
                router.refresh();
              }
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
