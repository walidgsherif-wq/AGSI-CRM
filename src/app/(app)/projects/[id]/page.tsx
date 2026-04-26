import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import { ProjectForm, type ProjectInitial } from '../_components/ProjectForm';
import {
  PROJECT_STAGE_LABEL,
  PROJECT_PRIORITY_LABEL,
} from '@/lib/zod/project';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const dynamic = 'force-dynamic';

type DetailRow = ProjectInitial & {
  id: string;
  bnc_reference_number: string | null;
  is_dormant: boolean;
  created_at: string;
};

type LinkedCompanyRow = {
  role: string;
  company: {
    id: string;
    canonical_name: string;
    company_type: keyof typeof COMPANY_TYPE_LABEL;
    current_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  } | null;
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, name, project_type, stage, value_aed, value_usd, city, location, sector, industry, estimated_completion_date, completion_percentage, agsi_priority, agsi_internal_notes, bnc_reference_number, is_dormant, created_at',
    )
    .eq('id', params.id)
    .single<DetailRow>();

  if (!project) notFound();

  const { data: linked } = await supabase
    .from('project_companies')
    .select(
      'role, company:companies(id, canonical_name, company_type, current_level)',
    )
    .eq('project_id', params.id)
    .eq('is_current', true)
    .returns<LinkedCompanyRow[]>();

  const editable = user.role !== 'leadership';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="text-xs text-agsi-darkGray hover:underline">
          ← Projects
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-agsi-navy">{project.name}</h1>
          {project.agsi_priority && (
            <Badge
              variant={
                project.agsi_priority === 'tier_1'
                  ? 'purple'
                  : project.agsi_priority === 'tier_2'
                    ? 'blue'
                    : project.agsi_priority === 'tier_3'
                      ? 'neutral'
                      : 'amber'
              }
            >
              {PROJECT_PRIORITY_LABEL[project.agsi_priority]}
            </Badge>
          )}
          {project.is_dormant && <Badge variant="red">Dormant</Badge>}
        </div>
        <p className="mt-1 text-sm text-agsi-darkGray">
          {PROJECT_STAGE_LABEL[project.stage]}
          {project.city && ` · ${project.city}`}
          {project.bnc_reference_number && ` · BNC ref ${project.bnc_reference_number}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {editable
              ? 'BNC fields will be read-only once linked to an upload (M5).'
              : 'Read-only — leadership view.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm mode="edit" initial={project} editable={editable} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked companies</CardTitle>
          <CardDescription>
            {(linked?.length ?? 0)} current participants.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!linked || linked.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No linked companies yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Role on project</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Level</th>
                </tr>
              </thead>
              <tbody>
                {linked
                  .filter((l) => l.company)
                  .map((l) => (
                    <tr
                      key={`${l.company!.id}-${l.role}`}
                      className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                    >
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/companies/${l.company!.id}`}
                          className="text-agsi-navy hover:underline"
                        >
                          {l.company!.canonical_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray capitalize">
                        {l.role.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {COMPANY_TYPE_LABEL[l.company!.company_type] ?? l.company!.company_type}
                      </td>
                      <td className="px-4 py-3">
                        <LevelBadge level={l.company!.current_level} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
