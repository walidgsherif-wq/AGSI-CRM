'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { updateEcosystemPoint } from '@/server/actions/admin-settings';

type Row = {
  id: string;
  event_category: string;
  event_subtype: string;
  points_default: number;
  points_current: number;
};

export function EcosystemPointScaleCard({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-agsi-darkGray">
        No ecosystem_point_scale rows seeded yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Subtype</th>
            <th className="px-4 py-2 font-medium">Default</th>
            <th className="px-4 py-2 font-medium">Current</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PointRow key={r.id} initial={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PointRow({ initial }: { initial: Row }) {
  const router = useRouter();
  const [points, setPoints] = useState(Number(initial.points_current));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: true; error?: string } | null>(null);

  const dirty = points !== Number(initial.points_current);
  const overridden = Number(initial.points_current) !== Number(initial.points_default);

  return (
    <tr className="border-b border-agsi-lightGray/50">
      <td className="px-4 py-2 font-mono text-xs text-agsi-darkGray">
        {initial.event_category}
      </td>
      <td className="px-4 py-2 font-medium text-agsi-navy">
        {initial.event_subtype}
        {overridden && (
          <Badge variant="amber" className="ml-2">
            override
          </Badge>
        )}
      </td>
      <td className="px-4 py-2 tabular-nums text-agsi-darkGray">
        {Number(initial.points_default)}
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          step={0.5}
          value={points}
          onChange={(e) => { setPoints(Number(e.target.value) || 0); setStatus(null); }}
          className="w-24 rounded border border-agsi-midGray px-2 py-1 text-sm tabular-nums"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => {
            setStatus(null);
            startTransition(async () => {
              const result = await updateEcosystemPoint(
                initial.event_category,
                initial.event_subtype,
                points,
              );
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
