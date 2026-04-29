'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import sanitizeHtml from 'sanitize-html';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  engagementCreateSchema,
  engagementUpdateSchema,
  type EngagementType,
} from '@/lib/zod/engagement';

export type EngagementDetails = {
  id: string;
  company_id: string;
  engagement_type: EngagementType;
  summary: string;
  engagement_date: string;
  created_at: string;
  created_by: string;
  project_id: string | null;
  author_name: string | null;
  project: { id: string; name: string } | null;
  email: {
    id: string;
    message_id: string;
    from_email: string;
    from_name: string | null;
    to_emails: string[];
    cc_emails: string[];
    subject: string;
    body_text: string | null;
    body_html_safe: string | null;
    has_attachments: boolean;
    received_at: string;
    direction: 'inbound' | 'outbound';
    raw_payload: unknown;
  } | null;
};

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

function rawFromForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? '' : String(v);
  };
  return {
    company_id: get('company_id'),
    project_id: get('project_id'),
    engagement_type: get('engagement_type'),
    summary: get('summary'),
    engagement_date: get('engagement_date'),
  };
}

export async function createEngagement(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot create engagements.' };

  const parsed = engagementCreateSchema.safeParse(rawFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { error } = await supabase()
    .from('engagements')
    .insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: error.message };
  revalidatePath(`/companies/${parsed.data.company_id}/engagements`);
  return { ok: true };
}

export async function updateEngagement(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'Leadership cannot edit engagements.' };
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing id.' };
  const parsed = engagementUpdateSchema.safeParse({ id, ...rawFromForm(formData) });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  const { id: _id, ...update } = parsed.data;
  const { error } = await supabase().from('engagements').update(update).eq('id', id);
  if (error) return { error: error.message };
  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}/engagements`);
  return { ok: true };
}

export async function deleteEngagement(id: string, companyId: string) {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };
  const { error } = await supabase().rpc('delete_engagement_with_audit', {
    p_engagement_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/companies/${companyId}/engagements`);
  return { ok: true };
}

type EngagementJoinRow = {
  id: string;
  company_id: string;
  engagement_type: EngagementType;
  summary: string;
  engagement_date: string;
  created_at: string;
  created_by: string;
  project_id: string | null;
  author: { full_name: string } | { full_name: string }[] | null;
  project: { id: string; name: string } | { id: string; name: string }[] | null;
  emails:
    | Array<{
        id: string;
        message_id: string;
        from_email: string;
        from_name: string | null;
        to_emails: string[];
        cc_emails: string[];
        subject: string;
        body_text: string | null;
        body_html: string | null;
        has_attachments: boolean;
        received_at: string;
        direction: 'inbound' | 'outbound';
        raw_payload: unknown;
      }>
    | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function getEngagement(
  id: string,
): Promise<{ data: EngagementDetails | null; error?: string }> {
  const user = await getCurrentUser();
  const includeRawPayload = user.role === 'admin';
  const { data, error } = await supabase()
    .from('engagements')
    .select(
      `id, company_id, engagement_type, summary, engagement_date, created_at, created_by, project_id,
       author:profiles!engagements_created_by_fkey(full_name),
       project:projects(id, name),
       emails:engagement_emails(id, message_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, has_attachments, received_at, direction${includeRawPayload ? ', raw_payload' : ''})`,
    )
    .eq('id', id)
    .maybeSingle()
    .returns<EngagementJoinRow>();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null };

  const author = pickOne(data.author);
  const project = pickOne(data.project);
  const rawEmail = data.emails && data.emails.length > 0 ? data.emails[0] : null;

  const email = rawEmail
    ? {
        id: rawEmail.id,
        message_id: rawEmail.message_id,
        from_email: rawEmail.from_email,
        from_name: rawEmail.from_name,
        to_emails: rawEmail.to_emails,
        cc_emails: rawEmail.cc_emails,
        subject: rawEmail.subject,
        body_text: rawEmail.body_text,
        body_html_safe: rawEmail.body_html
          ? sanitizeHtml(rawEmail.body_html, {
              allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                'img',
                'h1',
                'h2',
              ]),
              allowedAttributes: {
                ...sanitizeHtml.defaults.allowedAttributes,
                a: ['href', 'name', 'target', 'rel'],
                img: ['src', 'alt', 'title', 'width', 'height'],
                '*': ['style'],
              },
              allowedSchemes: ['http', 'https', 'mailto', 'cid'],
              transformTags: {
                a: sanitizeHtml.simpleTransform('a', {
                  target: '_blank',
                  rel: 'noopener noreferrer',
                }),
              },
            })
          : null,
        has_attachments: rawEmail.has_attachments,
        received_at: rawEmail.received_at,
        direction: rawEmail.direction,
        raw_payload: includeRawPayload
          ? (rawEmail as unknown as { raw_payload: unknown }).raw_payload ?? null
          : null,
      }
    : null;

  return {
    data: {
      id: data.id,
      company_id: data.company_id,
      engagement_type: data.engagement_type,
      summary: data.summary,
      engagement_date: data.engagement_date,
      created_at: data.created_at,
      created_by: data.created_by,
      project_id: data.project_id,
      author_name: author?.full_name ?? null,
      project,
      email,
    },
  };
}
