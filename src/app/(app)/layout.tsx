import { getCurrentUser } from '@/lib/auth/get-user';
import { Sidebar } from '@/components/domain/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen bg-agsi-offWhite">
      <Sidebar role={user.role} fullName={user.fullName} email={user.email} />
      <div className="flex-1 overflow-x-hidden">
        <main className="mx-auto max-w-7xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
