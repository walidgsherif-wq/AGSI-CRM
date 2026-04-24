import { requireRole } from '@/lib/auth/require-role';
import { PagePlaceholder } from '../_components/PagePlaceholder';

export default async function ReportsPage() {
  // §7.3: reports blocked for bd_manager
  await requireRole(['admin', 'leadership', 'bd_head']);
  return (
    <PagePlaceholder
      title="Reports"
      milestone="M12 / M15"
      description="Hub for quarterly scorecard, per-BDM performance review, and leadership reports archive."
    />
  );
}
