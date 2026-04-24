import { requireRole } from '@/lib/auth/require-role';
import { PagePlaceholder } from '../_components/PagePlaceholder';

export default async function TasksPage() {
  await requireRole(['admin', 'bd_head', 'bd_manager']);
  return (
    <PagePlaceholder
      title="Tasks"
      milestone="M6"
      description="Manual tasks, stagnation-generated tasks, and system tasks."
    />
  );
}
