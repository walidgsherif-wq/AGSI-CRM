import { getCurrentUser } from '@/lib/auth/get-user';
import { AppShell } from './_components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppShell
      user={{ role: user.role, fullName: user.fullName, email: user.email }}
    >
      {children}
    </AppShell>
  );
}
