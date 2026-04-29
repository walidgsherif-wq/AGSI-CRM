'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createReport } from '@/server/actions/leadership-reports';
import {
  REPORT_TYPES,
  REPORT_TYPE_LABEL,
  type ReportType,
} from '@/lib/zod/leadership-report';

type Props = {
  defaultFiscalYear: number;
  defaultFiscalQuarter: number;
  defaultMonthLabel: string;
};

export function NewReportForm({
  defaultFiscalYear,
  defaultFiscalQuarter,
  defaultMonthLabel,
}: Props) {
  const [reportType, setReportType] = useState<ReportType>('quarterly_strategic');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isQuarterly = reportType === 'quarterly_strategic';
  const fy = defaultFiscalYear;
  const fq = defaultFiscalQuarter;

  // Sensible default period bounds.
  const quarterStart = `${fy}-${String((fq - 1) * 3 + 1).padStart(2, '0')}-01`;
  const quarterEndDate = new Date(Date.UTC(fy, fq * 3, 0)); // last day of fq's last month
  const quarterEnd = quarterEndDate.toISOString().slice(0, 10);

  const today = new Date();
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const monthEndDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const r = await createReport(formData);
          if (r && 'error' in r && r.error) setError(r.error);
        });
      }}
      className="space-y-4"
    >
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Report type</label>
        <select
          name="report_type"
          required
          value={reportType}
          onChange={(e) => setReportType(e.target.value as ReportType)}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        >
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {REPORT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Period label
        </label>
        <input
          name="period_label"
          required
          maxLength={120}
          defaultValue={isQuarterly ? `Q${fq} ${fy}` : defaultMonthLabel}
          key={reportType}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-agsi-darkGray">
          Shown in the report header. Examples: &ldquo;Q1 2026&rdquo;, &ldquo;March 2026&rdquo;.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Period start</label>
          <input
            name="period_start"
            type="date"
            required
            defaultValue={isQuarterly ? quarterStart : monthStart}
            key={`start-${reportType}`}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Period end</label>
          <input
            name="period_end"
            type="date"
            required
            defaultValue={isQuarterly ? quarterEnd : monthEnd}
            key={`end-${reportType}`}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Fiscal year</label>
          <input
            name="fiscal_year"
            type="number"
            required
            min={2020}
            max={2100}
            defaultValue={fy}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            Fiscal quarter {isQuarterly && <span className="text-rag-red">*</span>}
          </label>
          <select
            name="fiscal_quarter"
            defaultValue={isQuarterly ? String(fq) : ''}
            key={`fq-${reportType}`}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            <option value="">— None —</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
          {!isQuarterly && (
            <p className="mt-1 text-xs text-agsi-darkGray">Optional for monthly reports.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Generating…' : 'Generate Draft'}
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </form>
  );
}
