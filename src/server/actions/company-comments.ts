'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverComponentCookies } from '@/lib/supabase/cookie-adapter';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  companyCommentEditSchema,
  companyCommentPostSchema,
} from '@/lib/zod/company-comment';

function supabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { cookies: serverComponentCookies(cookies()) },
  );
}

/**
 * Post a comment on a company thread. Client passes the resolved
 * mention list; the RPC re-validates each id against active BD-team
 * profiles and fans out one 'mention' notification per unique
 * survivor, skipping the author. Returns the new comment id so the
 * client can highlight it optimistically.
 */
export async function postCompanyComment(input: {
  company_id: string;
  body: string;
  mentioned_ids: string[];
}): Promise<{ ok: true; commentId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!['admin', 'bd_head', 'bd_manager'].includes(user.role)) {
    return { error: 'Only BD team members can post comments.' };
  }
  const parsed = companyCommentPostSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { company_id, body, mentioned_ids } = parsed.data;

  const { data, error } = await supabase().rpc('post_company_comment', {
    p_company_id: company_id,
    p_body: body,
    p_mentioned_ids: mentioned_ids,
  });
  if (error) return { error: error.message };
  const commentId = data as string;

  revalidatePath(`/companies/${company_id}/discussion`);
  return { ok: true, commentId };
}

export async function editCompanyComment(input: {
  id: string;
  body: string;
  company_id: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };

  const parsed = companyCommentEditSchema.safeParse({
    id: input.id,
    body: input.body,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { error } = await supabase().rpc('edit_company_comment', {
    p_comment_id: parsed.data.id,
    p_new_body: parsed.data.body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/companies/${input.company_id}/discussion`);
  return { ok: true };
}

export async function deleteCompanyComment(
  commentId: string,
  companyId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (user.role === 'leadership') return { error: 'forbidden' };

  const { error } = await supabase().rpc('delete_company_comment', {
    p_comment_id: commentId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/companies/${companyId}/discussion`);
  return { ok: true };
}
