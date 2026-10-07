import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent } from '@/components/ui/card';
import { ROLE_LABEL } from '@/types/domain';
import { DataFreshnessBadge } from '@/components/domain/DataFreshnessBadge';
import { fetchFiscalStartMonth, getFiscalContext } from '@/lib/fiscal';
import { RebuildButton } from './_components/RebuildButton';
import { getActionQueue } from '@/server/actions/action-queue';
import { ActionQueuePanel } from './_components/ActionQueuePanel';
import { getAssignedByMe, getMyTasks } from '@/server/actions/my-tasks';
import { MyTasksPanel } from './_components/MyTasksPanel';
import { AssignedByMePanel } from './_components/AssignedByMePanel';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Phase 1a: the dashboard is now the operational page — "what needs
  // me today". The analysis blocks that used to sit below the action
  // queue moved out per §10.1 of the KPI target model spec:
  //   - Market value engagement, Engagement temperature,
  //     Segment penetration, Coverage radar  →  /insights/engagement
  //   - Playbook targets + Driver A–D cards                →  /reports/scorecard
  //   - Member contributions / contribution stacks         →  /insights/engagement
  //     (travels with CoverageRadarPanel; split flagged for Phase 1b)
  //   - My events, Team events                             →  /events
  // The BEI card was also deleted here (not relocated) — it is retired
  // in Phase 2 and was already hidden from bd_managers in Phase 0. The
  // bei_current_view / bei_for_caller DB objects are untouched.
  const user = await getCurrentUser();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const startMonth = await fetchFiscalStartMonth(supabase);
  const { fy, fq } = getFiscalContext(startMonth, new Date());

  // Daily action queue — the operational hero. Per-user prioritised
  // list of mentions, overdue tasks, cold owned stakeholders, and
  // (admin only) pending approvals. Read-only aggregation.
  const actionQueue = await getActionQueue();

  // My Tasks — the caller's own open + in-progress work (self-set
  // and lead-assigned). Every BD-team member sees this; leadership
  // has no owned tasks so we skip the fetch. Strict scope: RLS
  // (0106) already restricts SELECT to owner-or-assigner, and the
  // action filters owner_id = self on top.
  const isBdTeam = ['admin', 'bd_head', 'bd_manager'].includes(user.role);
  const myTasks = isBdTeam ? await getMyTasks() : null;

  // Lead-side "Tasks I've assigned" — admin/bd_head only. Never
  // fetched for bd_manager (also enforced inside the action).
  const canSeeAssignedByMe = user.role === 'admin' || user.role === 'bd_head';
  const assignedByMe = canSeeAssignedByMe ? await getAssignedByMe() : null;

  // Freshness only — a dashboard-local DataFreshnessBadge needs the
  // most recent kpi_actuals_daily snapshot date. The badge is kept so
  // viewers still see when the underlying numbers (now on Reports)
  // were last refreshed.
  const { data: snap } = await supabase
    .from('kpi_actuals_daily')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot_date: string }>();
  const snapshotDate = snap?.snapshot_date ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">Dashboard</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">
            {user.fullName} · {ROLE_LABEL[user.role]} · FY{fy} Q{fq}
          </p>
          <div className="mt-2">
            <DataFreshnessBadge asOf={snapshotDate} compact />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {user.role === 'admin' && <RebuildButton />}
        </div>
      </div>

      {!snapshotDate && (
        <Card>
          <CardContent className="p-4 text-sm text-agsi-darkGray">
            No KPI snapshot yet.{' '}
            {user.role === 'admin'
              ? 'Click "Rebuild KPI now" above to compute the first one.'
              : 'Ask an admin to run the first rebuild.'}
          </CardContent>
        </Card>
      )}

      <ActionQueuePanel
        greetingName={user.fullName}
        queue={actionQueue}
        currentUserId={user.id}
      />

      {myTasks && <MyTasksPanel initial={myTasks} currentUserId={user.id} />}

      {assignedByMe && assignedByMe.length > 0 && (
        <AssignedByMePanel rows={assignedByMe} currentUserId={user.id} />
      )}
    </div>
  );
}
