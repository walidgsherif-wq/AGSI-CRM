import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { UploadForm } from './_components/UploadForm';

export const dynamic = 'force-dynamic';

type UploadRow = {
  id: string;
  filename: string;
  file_date: string | null;
  uploaded_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  row_count: number;
  new_projects: number;
  updated_projects: number;
  new_companies: number;
  unmatched_companies: number;
  uploader: { full_name: string } | null;
};

const STATUS_VARIANT: Record<UploadRow['status'], 'neutral' | 'amber' | 'green' | 'red'> = {
  pending: 'neutral',
  processing: 'amber',
  completed: 'green',
  failed: 'red',
};

export default async function AdminUploadsPage() {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: uploads, error } = await supabase
    .from('bnc_uploads')
    .select(
      'id, filename, file_date, uploaded_at, status, row_count, new_projects, updated_projects, new_companies, unmatched_companies, uploader:profiles!bnc_uploads_uploaded_by_fkey(full_name)',
    )
    .order('uploaded_at', { ascending: false })
    .limit(50)
    .returns<UploadRow[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">BNC Uploads</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Weekly BNC database exports. Each upload runs the project + company resolver and
          produces an upload summary.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload a new file</CardTitle>
          <CardDescription>
            Soft cap ~500 rows (Vercel 60s function timeout). Larger files: split or use the
            Edge Function path (v1.1).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>{uploads?.length ?? 0} most recent uploads.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-rag-red">Failed to load: {error.message}</p>
          ) : !uploads || uploads.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No uploads yet.</p>
          ) : (
            <Table>
              <THead>
                <TR head>
                  <TH className="px-4">File</TH>
                  <TH className="px-4">File date</TH>
                  <TH className="px-4">Status</TH>
                  <TH className="px-4">Rows</TH>
                  <TH className="px-4">New projects</TH>
                  <TH className="px-4">Unmatched</TH>
                  <TH className="px-4">Uploaded</TH>
                </TR>
              </THead>
              <TBody>
                {uploads.map((u) => (
                  <TR key={u.id} className="hover:bg-agsi-lightGray/20">
                    <TD className="px-4 font-medium">
                      <Link
                        href={`/admin/uploads/${u.id}`}
                        className="text-agsi-navy hover:underline"
                      >
                        {u.filename}
                      </Link>
                    </TD>
                    <TD className="px-4 text-agsi-darkGray">{u.file_date ?? '—'}</TD>
                    <TD className="px-4">
                      <Badge variant={STATUS_VARIANT[u.status]}>{u.status}</Badge>
                    </TD>
                    <TD className="px-4 tabular text-agsi-darkGray">{u.row_count}</TD>
                    <TD className="px-4 tabular text-agsi-darkGray">{u.new_projects}</TD>
                    <TD className="px-4 tabular text-agsi-darkGray">
                      {u.unmatched_companies > 0 ? (
                        <Link
                          href="/admin/companies/merge"
                          className="text-agsi-accent hover:underline"
                        >
                          {u.unmatched_companies}
                        </Link>
                      ) : (
                        u.unmatched_companies
                      )}
                    </TD>
                    <TD className="px-4 text-agsi-darkGray">
                      {u.uploader?.full_name ?? 'Unknown'} ·{' '}
                      {new Date(u.uploaded_at).toLocaleDateString()}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
