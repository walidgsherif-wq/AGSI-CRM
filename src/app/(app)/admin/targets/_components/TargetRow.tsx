'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { upsertMemberTarget, clearMemberTarget } from '@/server/actions/kpi';

export function TargetRow({
  userId,
  fiscalYear,
  metricCode,
  metricLabel,
  playbookQ,
  override,
}: {
  userId: string;
  fiscalYear: number;
  metricCode: string;
  metricLabel: string;
  playbookQ: [number, number, number, number];
  override: [number, number, number, number] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = override ?? playbookQ;
  const [values, setValues] = useState<[number, number, number, number]>(initial);
  const isOverride = override !== null;

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set('user_id', userId);
    fd.set('metric_code', metricCode);
    fd.set('fiscal_year', String(fiscalYear));
    fd.set('q1_target', String(values[0]));
    fd.set('q2_target', String(values[1]));
    fd.set('q3_target', String(values[2]));
    fd.set('q4_target', String(values[3]));
    startTransition(async () => {
      const r = await upsertMemberTarget(fd);
      if (r.error) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const r = await clearMemberTarget(userId, metricCode, fiscalYear);
      if (r.error) setError(r.error);
      else {
        setValues(playbookQ);
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <tr className="border-b border-agsi-lightGray/50">
      <td className="px-4 py-2">
        <div className="font-medium text-agsi-navy">{metricLabel}</div>
        <div className="text-xs text-agsi-darkGray">{metricCode}</div>
      </td>
      {[0, 1, 2, 3].map((i) => (
        <td key={i} className="px-2 py-2 tabular">
          {editing ? (
            <input
              type="number"
              min={0}
              step="1"
              value={values[i]}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setValues((prev) => {
                  const next = [...prev] as [number, number, number, number];
                  next[i] = v;
                  return next;
                });
              }}
              className="w-16 rounded border border-agsi-midGray px-2 py-1 text-xs"
            />
          ) : (
            <span className={isOverride ? 'text-agsi-purple' : 'text-agsi-darkGray'}>
              {initial[i]}
            </span>
          )}
        </td>
      ))}
      <td className="px-4 py-2 tabular text-xs text-agsi-darkGray">
        {(editing ? values : initial).reduce((s, v) => s + v, 0)}
      </td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setValues(initial);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            {error && <span className="text-xs text-rag-red">{error}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-agsi-accent hover:underline"
            >
              Edit
            </button>
            {isOverride && (
              <button
                type="button"
                disabled={pending}
                onClick={clear}
                className="text-rag-red hover:underline disabled:opacity-50"
              >
                {pending ? 'Removing…' : 'Reset to playbook'}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
