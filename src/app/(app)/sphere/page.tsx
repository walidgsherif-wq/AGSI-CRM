import { notFound } from 'next/navigation';
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

export const dynamic = 'force-dynamic';

/**
 * Sphere of Interest — the curated target-stakeholder list.
 *
 * Read: everyone authenticated.
 * Write: admin/bd_head/bd_manager (governance enforced in the action +
 *   RLS + surfaced in the UI). Leadership sees the builder read-only —
 *   useful for reviewing target coverage without editing.
 *
 * Route lives at /sphere (not under /admin/*) because the admin layout
 * is admin-only via requireRole, and this feature explicitly needs
 * bd_head + bd_manager write access.
 */
export default async function SpherePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();

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

  const canEdit = ['admin', 'bd_head', 'bd_manager'].includes(user.role);

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
        <div className="rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-agsi-darkGray">
            Sphere size
          </span>
          <p className="text-2xl font-semibold tabular-nums text-agsi-navy">
            {data.sphereCount}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Builder</CardTitle>
          <CardDescription>
            {canEdit
              ? user.role === 'bd_manager'
                ? 'You can add stakeholders and remove ones you added yourself; admin/head-added rows are locked.'
                : 'You can add or remove any stakeholder.'
              : 'Read-only. Ask an admin, BD head, or BD manager to edit the sphere.'}
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
