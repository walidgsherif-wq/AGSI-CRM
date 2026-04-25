import { z } from 'zod';

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

export const noteCreateSchema = z
  .object({
    company_id: optionalUuid,
    project_id: optionalUuid,
    body: z.string().trim().min(1, 'Note body is required').max(8000),
    is_pinned: z.boolean().default(false),
  })
  .refine((d) => d.company_id || d.project_id, {
    message: 'Note must be linked to a company or a project.',
    path: ['company_id'],
  });

export const noteUpdateSchema = z.object({
  id: z.string().uuid(),
  body: z.string().trim().min(1).max(8000).optional(),
  is_pinned: z.boolean().optional(),
});

export type NoteCreate = z.infer<typeof noteCreateSchema>;
export type NoteUpdate = z.infer<typeof noteUpdateSchema>;
