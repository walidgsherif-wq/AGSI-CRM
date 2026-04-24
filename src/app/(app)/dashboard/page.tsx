import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { ROLE_LABEL, LEVELS } from '@/types/domain';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Dashboard</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            Welcome, {user.fullName}. Viewing as{' '}
            <span className="font-medium text-agsi-navy">{ROLE_LABEL[user.role]}</span>.
          </p>
        </div>
        <Badge variant="amber">M1 shell</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Milestone 1 — foundation shell</CardTitle>
          <CardDescription>
            Role-adaptive sidebar, AGSI brand theme, empty placeholder pages. Real
            dashboards arrive in milestones 8 (KPI tiles), 10 (ecosystem for leadership),
            11 (heat maps), and 12 (leadership reports).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Your role" value={ROLE_LABEL[user.role]} />
            <Detail label="Fiscal year" value="2026 (Jan–Dec)" />
            <Detail label="Working week" value="Mon–Fri" />
            <Detail label="Notifications" value="In-app only (M13)" />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>L-level palette preview</CardTitle>
            <CardDescription>
              The §15 colour map applied to the LevelBadge primitive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <LevelBadge key={l} level={l} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role-aware navigation</CardTitle>
            <CardDescription>
              Swap roles using the dev switcher at the bottom of the sidebar. Sidebar
              items appear and disappear per the §7.1 matrix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-agsi-darkGray">
              <li>Admin sees every item including the Admin section.</li>
              <li>Leadership sees read-only plus Reports, no Pipeline or Tasks.</li>
              <li>BD Head sees operational items but no Admin section.</li>
              <li>BD Manager loses Maps and Reports access.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-agsi-darkGray">{label}</dt>
      <dd className="mt-1 text-sm text-agsi-navy">{value}</dd>
    </div>
  );
}
