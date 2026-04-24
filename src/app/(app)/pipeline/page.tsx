import { requireRole } from '@/lib/auth/require-role';
import { PagePlaceholder } from '../_components/PagePlaceholder';

export default async function PipelinePage() {
  await requireRole(['admin', 'bd_head', 'bd_manager']);
  return (
    <PagePlaceholder
      title="Pipeline"
      milestone="M7"
      description="Kanban L0 → L5 board. Drag to change level via change_company_level()."
    />
  );
}
