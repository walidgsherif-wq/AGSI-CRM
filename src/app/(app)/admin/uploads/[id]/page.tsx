import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type Detail = {
  id: string;
  filename: string;
  file_date: string | null;
  storage_path: string;
  uploaded_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  row_count: number;
  new_projects: number;
  updated_projects: number;
  dormant_projects: number;
  new_companies: number;
  matched_companies: number;
  unmatched_companies: number;
  error_log: string | null;
  uploader: { full_name: string } | null;
};

const STATUS_VARIANT: Record<Detail['status'], 'neutral' | 'amber' | 'green' | 'red'> = {
  pending: 'neutral',
  processing: 'amber',
  completed: 'green',
  failed: 'red',
};

export default async function AdminUploadDetailPage({ params }: { params: { id: string } }) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data: upload } = await supabase
    .from('bnc_uploads')
    .select(
      'id, filename, file_date, storage_path, uploaded_at, status, row_count, new_projects, updated_projects, dormant_projects, new_companies, matched_companies, unmatched_companies, error_log, uploader:profiles!bnc_uploads_uploaded_by_fkey(full_name)',
    )
    .eq('id', params.id)
    .single<Detail>();

  if (!upload) notFound();

  const { count: queueCount } = await supabase
    .from('company_match_queue')
    .select('*', { count: 'exact', head: true })
    .eq('upload_id', upload.id)
    .eq('status', 'pending');

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/uploads" className="text-xs text-agsi-darkGray hover:underline">
          ← Uploads
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-agsi-navy">{upload.filename}</h1>
          <Badge variant={STATUS_VARIANT[upload.status]}>{upload.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-agsi-darkGray">
          File date {upload.file_date ?? '—'} · uploaded by {upload.uploader?.full_name ?? '—'} on{' '}
          {new Date(upload.uploaded_at).toLocaleString()}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Rows" value={upload.row_count} />
        <Stat label="New projects" value={upload.new_projects} />
        <Stat label="Updated projects" value={upload.updated_projects} />
        <Stat label="Dormant projects" value={upload.dormant_projects} />
        <Stat label="New companies" value={upload.new_companies} />
        <Stat label="Matched companies" value={upload.matched_companies} />
        <Stat
          label="Unmatched (admin review)"
          value={upload.unmatched_companies}
          accent={upload.unmatched_companies > 0 ? 'amber' : undefined}
        />
      </div>

      {(queueCount ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Match queue</CardTitle>
            <CardDescription>
              {queueCount} pending unmatched company name{(queueCount ?? 0) === 1 ? '' : 's'} waiting
              for review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/admin/companies/merge"
              className="inline-flex rounded-lg bg-agsi-navy px-4 py-2 text-sm font-medium text-white hover:bg-agsi-blue"
            >
              Open match queue →
            </Link>
          </CardContent>
        </Card>
      )}

      {upload.error_log && (
        <Card>
          <CardHeader>
            <CardTitle>Warnings / errors</CardTitle>
            <CardDescription>
              First 50 issues encountered during processing. Most are non-fatal (unknown stage
              strings mapped to &quot;concept&quot;, etc.).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-lg bg-agsi-lightGray/40 p-4 text-xs text-agsi-darkGray">
              {upload.error_log}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>The original file is preserved in the bnc-uploads bucket.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block rounded-lg bg-agsi-lightGray/40 px-3 py-2 text-xs text-agsi-darkGray">
            {upload.storage_path}
          </code>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'amber';
}) {
  return (
    <div className="rounded-xl border border-agsi-lightGray bg-white p-4">
      <p className="text-xs uppercase tracking-wider text-agsi-darkGray">{label}</p>
      <p
        className={
          accent === 'amber'
            ? 'mt-1 text-2xl font-semibold tabular text-rag-amber'
            : 'mt-1 text-2xl font-semibold tabular text-agsi-navy'
        }
      >
        {value}
      </p>
    </div>
  );
}
