import { getCurrentUser } from '@/lib/auth/get-user';
import { getFeatureAccess } from '@/lib/auth/features';
import { AppShell } from './_components/AppShell';
import { SetupModeBanner } from './_components/SetupModeBanner';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const features = await getFeatureAccess(user);

  return (
    <AppShell
      user={{ role: user.role, fullName: user.fullName, email: user.email }}
      features={[...features]}
      banner={<SetupModeBanner />}
    >
      {children}
    </AppShell>
  );
}
