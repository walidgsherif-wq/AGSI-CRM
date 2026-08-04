import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';
import { SPOKE_TYPES } from '@/types/coverage';
import { sphereQuerySchema } from '@/lib/zod/sphere';
import { getSphereBuilderRows } from '@/server/actions/sphere';
import { SphereBuilder } from './_components/SphereBuilder';
import { ClearSphereButton } from './_components/ClearSphereButton';

export const dynamic = 'force-dynamic';

/**
 * Sphere of Interest — the curated target-stakeholder list.
 *
 * Access: admin + bd_head only. bd_manager still sees the sphere-
 * scoped dashboard metrics (Build B) and keeps "Propose for sphere"
 * on the stakeholder card — but the builder itself is a lead-only
 * curation tool. Leadership doesn't need it either.
 *
 * Route lives at /sphere (not under /admin/*) because the admin
 * layout is `requireRole(['admin'])` — bd_head needs write access
 * too, so the gate lives here.
 */
export default async function SpherePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();

  // Server-side role gate — the sidebar hides the link for
  // bd_manager + leadership, but a direct URL hit must also bounce.
  // This is the primary block; nav visibility is UX polish.
  if (user.role !== 'admin' && user.role !== 'bd_head') {
    redirect('/dashboard');
  }

  const parsed = sphereQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(searchParams).map(([k, v]) => [
        k,
        Array.isArray(v) ? v[0] : v,
      ]),
    ),
  );
  if (!parsed.success) notFound();
  const q = parsed.data;

  const data = await getSphereBuilderRows(q);

  // Only admin/bd_head reach this line (the redirect above bounced
  // everyone else) — the SphereBuilder still takes canEdit so the
  // component stays reusable if this ever needs a read-only preview.
  const canEdit = true;

  const typeOptions = (SPOKE_TYPES as readonly string[]).map((k) => ({
    value: k,
    label:
      (COMPANY_TYPE_LABEL as Record<string, string>)[k] ?? k,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">
            Sphere of Interest
          </h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Curate the target-stakeholder list metrics can measure
            against — sorted by project value involved and by project
            count to focus on the deals that matter.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-sm">
            <span className="text-xs uppercase tracking-wider text-agsi-darkGray">
              Sphere size
            </span>
            <p className="text-2xl font-semibold tabular-nums text-agsi-navy">
              {data.sphereCount}
            </p>
          </div>
          {(user.role === 'admin' || user.role === 'bd_head') && (
            <ClearSphereButton sphereCount={data.sphereCount} />
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Builder</CardTitle>
          <CardDescription>
            You can add or remove any stakeholder directly. Manager
            proposals appear as notifications for you to approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SphereBuilder
            initialData={data}
            initialQuery={q}
            typeOptions={typeOptions}
            currentUserId={user.id}
            currentUserRole={user.role}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
