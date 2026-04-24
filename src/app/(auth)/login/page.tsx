import { Suspense } from 'react';
import { LoginForm } from './_components/LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  return (
    <Suspense>
      <LoginForm error={searchParams.error} next={searchParams.next ?? '/dashboard'} />
    </Suspense>
  );
}
