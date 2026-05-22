import { renderToBuffer } from '@react-pdf/renderer';
import { LeadershipReportPdf } from './LeadershipReportPdf';
import type { LeadershipReportPayload } from '@/lib/zod/leadership-report';

export type LeadershipReportRenderInput = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  report_type: string;
  status: string;
  finalised_at: string | null;
  executive_summary: string | null;
  leadership_feedback_text: string | null;
  leadership_feedback_at: string | null;
  feedback_by_name: string | null;
};

export async function renderLeadershipPdfBuffer(
  report: LeadershipReportRenderInput,
  payload: LeadershipReportPayload,
): Promise<Buffer> {
  return renderToBuffer(
    <LeadershipReportPdf report={report} payload={payload} />,
  );
}

export function leadershipPdfStoragePath(reportId: string, periodLabel: string): string {
  const safe = periodLabel.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-');
  return `${reportId}/leadership-${safe || 'report'}.pdf`;
}
