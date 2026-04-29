import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NewReportForm } from './_components/NewReportForm';

export const dynamic = 'force-dynamic';

export default function NewReportPage() {
  // Admin layout already enforces requireRole(['admin']).
  const today = new Date();
  const fy = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1..12
  const fq = Math.ceil(m / 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">New leadership report</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Pick a type + period, then click <strong>Generate Draft</strong>. The generator
          aggregates KPIs, ecosystem awareness, pipeline movements, heat-map counts, and
          per-stakeholder snapshots into a frozen payload.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
          <CardDescription>
            Defaults below assume the current quarter. Adjust as needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewReportForm
            defaultFiscalYear={fy}
            defaultFiscalQuarter={fq}
            defaultMonthLabel={today.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
