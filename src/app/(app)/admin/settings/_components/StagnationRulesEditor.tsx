'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateStagnationRule } from '@/server/actions/admin-settings';

type Rule = {
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  max_days_in_level: number;
  warn_at_pct: number;
  escalate_at_pct: number;
  escalation_role: 'bd_head' | 'admin';
  is_active: boolean;
};

export function StagnationRulesEditor({ rules }: { rules: Rule[] }) {
  if (rules.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-agsi-darkGray">
        No stagnation rules seeded yet. Apply migration{' '}
        <code>0014_stagnation_notifications.sql</code> + the seed script.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
            <th className="px-4 py-2 font-medium">Level</th>
            <th className="px-4 py-2 font-medium">Max days</th>
            <th className="px-4 py-2 font-medium">Warn at %</th>
            <th className="px-4 py-2 font-medium">Escalate at %</th>
            <th className="px-4 py-2 font-medium">Escalation role</th>
            <th className="px-4 py-2 font-medium">Active</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <RuleRow key={r.level} initial={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleRow({ initial }: { initial: Rule }) {
  const router = useRouter();
  const [r, setR] = useState<Rule>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty =
    r.max_days_in_level !== initial.max_days_in_level ||
    r.warn_at_pct !== initial.warn_at_pct ||
    r.escalate_at_pct !== initial.escalate_at_pct ||
    r.escalation_role !== initial.escalation_role ||
    r.is_active !== initial.is_active;

  return (
    <tr className="border-b border-agsi-lightGray/50">
      <td className="px-4 py-2 font-mono text-sm font-semibold text-agsi-navy">{r.level}</td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={1}
          value={r.max_days_in_level}
          onChange={(e) => { setR({ ...r, max_days_in_level: Number(e.target.value) || 0 }); setStatus(null); }}
          className="w-20 rounded border border-agsi-midGray px-2 py-1 text-sm tabular-nums"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={1}
          max={100}
          value={r.warn_at_pct}
          onChange={(e) => { setR({ ...r, warn_at_pct: Number(e.target.value) || 0 }); setStatus(null); }}
          className="w-20 rounded border border-agsi-midGray px-2 py-1 text-sm tabular-nums"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={1}
          max={200}
          value={r.escalate_at_pct}
          onChange={(e) => { setR({ ...r, escalate_at_pct: Number(e.target.value) || 0 }); setStatus(null); }}
          className="w-20 rounded border border-agsi-midGray px-2 py-1 text-sm tabular-nums"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={r.escalation_role}
          onChange={(e) => { setR({ ...r, escalation_role: e.target.value as 'bd_head' | 'admin' }); setStatus(null); }}
          className="rounded border border-agsi-midGray px-2 py-1 text-sm"
        >
          <option value="bd_head">bd_head</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={r.is_active}
          onChange={(e) => { setR({ ...r, is_active: e.target.checked }); setStatus(null); }}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => {
            setStatus(null);
            startTransition(async () => {
              const result = await updateStagnationRule(r);
              if ('error' in result) setStatus({ error: result.error });
              else {
                setStatus({ ok: true });
                router.refresh();
              }
            });
          }}
          className="rounded bg-agsi-navy px-2 py-1 text-xs font-medium text-white hover:bg-agsi-blue disabled:opacity-50"
        >
          {pending ? '…' : 'Save'}
        </button>
        {status?.error && <p className="mt-1 text-[10px] text-rag-red">{status.error}</p>}
        {status?.ok && <p className="mt-1 text-[10px] text-agsi-green">Saved</p>}
      </td>
    </tr>
  );
}
