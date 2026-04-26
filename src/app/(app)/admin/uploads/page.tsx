import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">File date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Rows</th>
                  <th className="px-4 py-2 font-medium">New projects</th>
                  <th className="px-4 py-2 font-medium">Unmatched</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-agsi-lightGray/50 hover:bg-agsi-lightGray/20"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/admin/uploads/${u.id}`}
                        className="text-agsi-navy hover:underline"
                      >
                        {u.filename}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">{u.file_date ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[u.status]}>{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{u.row_count}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">{u.new_projects}</td>
                    <td className="px-4 py-3 tabular text-agsi-darkGray">
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
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">
                      {u.uploader?.full_name ?? 'Unknown'} ·{' '}
                      {new Date(u.uploaded_at).toLocaleDateString()}
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
