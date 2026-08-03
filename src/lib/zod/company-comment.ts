import { z } from 'zod';

/**
 * Server-side validation for a company-comment post. The composer
 * emits body + a resolved list of mentioned profile ids (client-side
 * @-token resolution — the RPC re-checks that each id is an active
 * BD-team profile, so a stale / crafted id is silently dropped).
 */
export const companyCommentPostSchema = z.object({
  company_id: z.string().uuid('company_id must be a uuid'),
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(4000, 'Comment is capped at 4000 characters'),
  mentioned_ids: z.array(z.string().uuid()).max(50, 'Too many mentions'),
});

export type CompanyCommentPostInput = z.infer<typeof companyCommentPostSchema>;

export const companyCommentEditSchema = z.object({
  id: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(4000, 'Comment is capped at 4000 characters'),
});
