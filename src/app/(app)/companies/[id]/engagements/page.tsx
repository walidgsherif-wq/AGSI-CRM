import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ENGAGEMENT_TYPE_LABEL, type EngagementType } from '@/lib/zod/engagement';
import { EngagementForm } from './_components/EngagementForm';
import { DeleteEngagementButton } from './_components/DeleteEngagementButton';

export const dynamic = 'force-dynamic';

type EngagementRow = {
  id: string;
  engagement_type: EngagementType;
  summary: string;
  engagement_date: string;
  created_at: string;
  created_by: string;
  project_id: string | null;
  author: { full_name: string } | null;
  project: { id: string; name: string } | null;
};

export default async function CompanyEngagementsTab({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const [engagementsRes, projectsRes] = await Promise.all([
    supabase
      .from('engagements')
      .select(
        'id, engagement_type, summary, engagement_date, created_at, created_by, project_id, author:profiles!engagements_created_by_fkey(full_name), project:projects(id, name)',
      )
      .eq('company_id', params.id)
      .order('engagement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<EngagementRow[]>(),
    supabase
      .from('project_companies')
      .select('project:projects(id, name)')
      .eq('company_id', params.id)
      .eq('is_current', true),
  ]);

  const engagements = engagementsRes.data ?? [];
  const projects: Array<{ id: string; name: string }> = [];
  for (const r of (projectsRes.data ?? []) as Array<{
    project: { id: string; name: string } | { id: string; name: string }[] | null;
  }>) {
    const p = Array.isArray(r.project) ? r.project[0] : r.project;
    if (p) projects.push(p);
  }

  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-4">
      {canCreate && <EngagementForm companyId={params.id} projects={projects} />}

      <Card>
        <CardHeader>
          <CardTitle>Engagement log</CardTitle>
          <CardDescription>
            {engagements.length} most recent. Each entry feeds Driver C credit + the stagnation
            timer.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {engagements.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No engagements logged yet.{' '}
              {canCreate && 'Click "Log engagement" above to record the first one.'}
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {engagements.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="blue">{ENGAGEMENT_TYPE_LABEL[e.engagement_type]}</Badge>
                        <span className="text-xs text-agsi-darkGray">{e.engagement_date}</span>
                        {e.project && (
                          <Link
                            href={`/projects/${e.project.id}`}
                            className="text-xs text-agsi-accent hover:underline"
                          >
                            ↳ {e.project.name}
                          </Link>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-agsi-navy">
                        {e.summary}
                      </p>
                      <p className="mt-1 text-xs text-agsi-darkGray">
                        by {e.author?.full_name ?? 'Unknown'}
                      </p>
                    </div>
                    {(user.role === 'admin' ||
                      (user.role !== 'leadership' && e.created_by === user.id)) && (
                      <DeleteEngagementButton id={e.id} companyId={params.id} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
