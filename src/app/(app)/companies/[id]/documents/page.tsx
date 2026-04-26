import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DOCUMENT_TYPE_LABEL, type DocumentType } from '@/lib/zod/document';
import { DocumentUploadForm } from './_components/DocumentUploadForm';
import { DocumentRowActions } from './_components/DocumentRowActions';

export const dynamic = 'force-dynamic';

type DocRow = {
  id: string;
  doc_type: DocumentType;
  title: string;
  storage_path: string;
  signed_date: string | null;
  expiry_date: string | null;
  uploaded_by: string;
  is_archived: boolean;
  created_at: string;
  uploader: { full_name: string } | null;
};

export default async function CompanyDocumentsTab({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { archived?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
  const showArchived = searchParams.archived === '1';

  const { data } = await supabase
    .from('documents')
    .select(
      'id, doc_type, title, storage_path, signed_date, expiry_date, uploaded_by, is_archived, created_at, uploader:profiles!documents_uploaded_by_fkey(full_name)',
    )
    .eq('company_id', params.id)
    .eq('is_archived', showArchived)
    .order('signed_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .returns<DocRow[]>();

  const docs = data ?? [];
  const canUpload = user.role !== 'leadership';

  return (
    <div className="space-y-4">
      {canUpload && <DocumentUploadForm companyId={params.id} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Documents
            <a
              href={`/companies/${params.id}/documents${showArchived ? '' : '?archived=1'}`}
              className="text-xs font-normal text-agsi-accent hover:underline"
            >
              {showArchived ? '← Show active' : 'Show archived →'}
            </a>
          </CardTitle>
          <CardDescription>
            {docs.length} {showArchived ? 'archived' : 'active'} document
            {docs.length === 1 ? '' : 's'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {docs.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No {showArchived ? 'archived' : ''} documents.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Signed</th>
                  <th className="px-4 py-2 font-medium">Expires</th>
                  <th className="px-4 py-2 font-medium">Uploaded by</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const canDelete =
                    user.role === 'admin' ||
                    (user.role !== 'leadership' && d.uploaded_by === user.id);
                  return (
                    <tr key={d.id} className="border-b border-agsi-lightGray/50">
                      <td className="px-4 py-3 font-medium text-agsi-navy">{d.title}</td>
                      <td className="px-4 py-3">
                        <Badge variant="blue">{DOCUMENT_TYPE_LABEL[d.doc_type]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-agsi-darkGray">{d.signed_date ?? '—'}</td>
                      <td className="px-4 py-3 text-agsi-darkGray">{d.expiry_date ?? '—'}</td>
                      <td className="px-4 py-3 text-agsi-darkGray">
                        {d.uploader?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <DocumentRowActions
                          id={d.id}
                          companyId={params.id}
                          storagePath={d.storage_path}
                          canDelete={canDelete}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
