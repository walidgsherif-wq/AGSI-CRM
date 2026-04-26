import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NoteForm } from './_components/NoteForm';
import { NoteActions } from './_components/NoteActions';

export const dynamic = 'force-dynamic';

type NoteRow = {
  id: string;
  body: string;
  is_pinned: boolean;
  author_id: string;
  created_at: string;
  updated_at: string;
  author: { full_name: string } | null;
};

export default async function CompanyNotesTab({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-agsi-darkGray">
          Notes are not available to leadership.
        </CardContent>
      </Card>
    );
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );

  const { data } = await supabase
    .from('notes')
    .select('id, body, is_pinned, author_id, created_at, updated_at, author:profiles!notes_author_id_fkey(full_name)')
    .eq('company_id', params.id)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<NoteRow[]>();

  const notes = data ?? [];

  return (
    <div className="space-y-4">
      <NoteForm companyId={params.id} />

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
          <CardDescription>
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}. Pinned notes appear first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {notes.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">No notes yet.</p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {notes.map((n) => {
                const canDelete =
                  user.role === 'admin' || (user.role !== 'leadership' && n.author_id === user.id);
                return (
                  <li key={n.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {n.is_pinned && <Badge variant="gold">Pinned</Badge>}
                          <span className="text-xs text-agsi-darkGray">
                            {n.author?.full_name ?? 'Unknown'} ·{' '}
                            {new Date(n.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-agsi-navy">{n.body}</p>
                      </div>
                      <NoteActions
                        id={n.id}
                        companyId={params.id}
                        isPinned={n.is_pinned}
                        canDelete={canDelete}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
