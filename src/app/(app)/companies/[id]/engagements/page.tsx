import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { type EngagementType } from '@/lib/zod/engagement';
import { EngagementForm } from './_components/EngagementForm';
import { EngagementsList, type EngagementRowData } from './_components/EngagementsList';

export const dynamic = 'force-dynamic';

type EngagementRow = {
  id: string;
  engagement_type: EngagementType;
  summary: string;
  engagement_date: string;
  created_at: string;
  created_by: string;
  project_id: string | null;
  author: { full_name: string } | { full_name: string }[] | null;
  project: { id: string; name: string } | { id: string; name: string }[] | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

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

  const engagements: EngagementRowData[] = (engagementsRes.data ?? []).map((e) => ({
    id: e.id,
    engagement_type: e.engagement_type,
    summary: e.summary,
    engagement_date: e.engagement_date,
    created_by: e.created_by,
    project: pickOne(e.project),
    author_name: pickOne(e.author)?.full_name ?? null,
  }));

  const projects: Array<{ id: string; name: string }> = [];
  for (const r of (projectsRes.data ?? []) as Array<{
    project: { id: string; name: string } | { id: string; name: string }[] | null;
  }>) {
    const p = pickOne(r.project);
    if (p) projects.push(p);
  }

  const canCreate = user.role !== 'leadership';

  return (
    <div className="space-y-4">
      {canCreate && <EngagementForm companyId={params.id} projects={projects} />}
      <EngagementsList
        companyId={params.id}
        engagements={engagements}
        projects={projects}
        role={user.role}
        currentUserId={user.id}
        canCreate={canCreate}
      />
    </div>
  );
}
