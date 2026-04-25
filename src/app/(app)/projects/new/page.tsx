import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProjectForm } from '../_components/ProjectForm';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (user.role === 'leadership') notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="text-xs text-agsi-darkGray hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-agsi-navy">New project</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Manual entry. BNC uploads (M5) populate this list automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Required: name + stage. Link to companies after creation (M6).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm mode="create" editable />
        </CardContent>
      </Card>
    </div>
  );
}
