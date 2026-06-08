import { requireRole } from '@/lib/auth/require-role';
import { AdminSubNav } from './_components/AdminSubNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['admin']);

  return (
    <div className="space-y-6">
      <AdminSubNav />
      {children}
    </div>
  );
}
