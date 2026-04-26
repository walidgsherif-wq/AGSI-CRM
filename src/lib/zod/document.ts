import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'mou_developer',
  'mou_consultant',
  'mou_contractor',
  'tripartite',
  'epd',
  'case_study',
  'site_banner_approval',
  'announcement',
  'spec_template',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  mou_developer: 'MOU — Developer',
  mou_consultant: 'MOU — Consultant',
  mou_contractor: 'MOU — Contractor',
  tripartite: 'Tripartite agreement',
  epd: 'EPD',
  case_study: 'Case study',
  site_banner_approval: 'Site banner approval',
  announcement: 'Announcement',
  spec_template: 'Spec template',
  other: 'Other',
};

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

/** Used by the server action AFTER the browser uploaded the file to storage. */
export const documentCreateSchema = z
  .object({
    company_id: optionalUuid,
    project_id: optionalUuid,
    doc_type: z.enum(DOCUMENT_TYPES),
    title: z.string().trim().min(1, 'Title is required').max(300),
    storage_path: z.string().trim().min(1),
    signed_date: optionalDate,
    expiry_date: optionalDate,
  })
  .refine((d) => d.company_id || d.project_id, {
    message: 'Document must be linked to a company or a project.',
    path: ['company_id'],
  })
  .refine(
    (d) => !d.signed_date || !d.expiry_date || d.expiry_date >= d.signed_date,
    { message: 'Expiry date must be on/after signed date.', path: ['expiry_date'] },
  );

export const documentUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  signed_date: optionalDate,
  expiry_date: optionalDate,
  is_archived: z.boolean().optional(),
});

export type DocumentCreate = z.infer<typeof documentCreateSchema>;
export type DocumentUpdate = z.infer<typeof documentUpdateSchema>;
