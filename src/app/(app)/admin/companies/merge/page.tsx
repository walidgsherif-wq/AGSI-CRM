import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { requireRole } from '@/lib/auth/require-role';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MatchQueueActions } from './_components/MatchQueueActions';

export const dynamic = 'force-dynamic';

type QueueRow = {
  id: string;
  upload_id: string;
  raw_name: string;
  similarity_score: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  created_at: string;
  suggested_company_id: string | null;
  suggested: { id: string; canonical_name: string; company_type: string } | null;
  upload: { filename: string; file_date: string | null } | null;
};

export default async function MatchQueuePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  await requireRole(['admin']);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const status = searchParams.status ?? 'pending';

  const { data, error } = await supabase
    .from('company_match_queue')
    .select(
      'id, upload_id, raw_name, similarity_score, status, created_at, suggested_company_id, suggested:companies!company_match_queue_suggested_company_id_fkey(id, canonical_name, company_type), upload:bnc_uploads!company_match_queue_upload_id_fkey(filename, file_date)',
    )
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<QueueRow[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Match queue</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Companies the BNC resolver couldn&apos;t auto-link (similarity 0.75–0.85). Approve to
          merge with the suggestion, create as a new company, or reject the row.
        </p>
      </div>

      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected', 'merged'] as const).map((s) => (
          <Link
            key={s}
            href={`/admin/companies/merge?status=${s}`}
            className={
              status === s
                ? 'rounded-lg bg-agsi-navy px-3 py-1 text-xs font-medium text-white'
                : 'rounded-lg border border-agsi-midGray px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40'
            }
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{data?.length ?? 0} entries</CardTitle>
          <CardDescription>Filtered by status: {status}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-rag-red">Failed to load: {error.message}</p>
          ) : !data || data.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No {status} entries.{' '}
              {status === 'pending' && 'All caught up — nothing waiting for review.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Raw BNC name</th>
                  <th className="px-4 py-2 font-medium">Similarity</th>
                  <th className="px-4 py-2 font-medium">Suggested match</th>
                  <th className="px-4 py-2 font-medium">From upload</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((q) => (
                  <tr key={q.id} className="border-b border-agsi-lightGray/50">
                    <td className="px-4 py-3 font-medium">{q.raw_name}</td>
                    <td className="px-4 py-3">
                      {q.similarity_score !== null ? (
                        <Badge
                          variant={q.similarity_score >= 0.8 ? 'green' : 'amber'}
                        >
                          {q.similarity_score.toFixed(2)}
                        </Badge>
                      ) : (
                        <span className="text-agsi-darkGray">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {q.suggested ? (
                        <Link
                          href={`/companies/${q.suggested.id}`}
                          className="text-agsi-navy hover:underline"
                        >
                          {q.suggested.canonical_name}
                        </Link>
                      ) : (
                        <span className="italic text-agsi-darkGray">No suggestion</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-agsi-darkGray">
                      <Link
                        href={`/admin/uploads/${q.upload_id}`}
                        className="hover:underline"
                      >
                        {q.upload?.filename ?? q.upload_id.slice(0, 8)}
                      </Link>
                      {q.upload?.file_date && (
                        <span className="ml-2 text-xs">{q.upload.file_date}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {status === 'pending' ? (
                        <MatchQueueActions
                          queueId={q.id}
                          hasSuggestion={!!q.suggested_company_id}
                        />
                      ) : (
                        <Badge variant="neutral">{status}</Badge>
                      )}
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
