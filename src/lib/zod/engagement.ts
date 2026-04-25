import { z } from 'zod';

export const ENGAGEMENT_TYPES = [
  'call',
  'meeting',
  'email',
  'site_visit',
  'workshop',
  'document_sent',
  'mou_discussion',
  'tripartite_discussion',
  'spec_inclusion',
  'design_stage_intro',
  'consultant_approval',
  'other',
] as const;

export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

export const ENGAGEMENT_TYPE_LABEL: Record<EngagementType, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  site_visit: 'Site visit',
  workshop: 'Workshop',
  document_sent: 'Document sent',
  mou_discussion: 'MOU discussion',
  tripartite_discussion: 'Tripartite discussion',
  spec_inclusion: 'Spec inclusion',
  design_stage_intro: 'Design-stage intro',
  consultant_approval: 'Consultant approval',
  other: 'Other',
};

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

export const engagementCreateSchema = z.object({
  company_id: z.string().uuid(),
  project_id: optionalUuid,
  engagement_type: z.enum(ENGAGEMENT_TYPES),
  summary: z.string().trim().min(1, 'Summary is required').max(4000),
  engagement_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

export const engagementUpdateSchema = engagementCreateSchema
  .partial()
  .extend({ id: z.string().uuid() });

export type EngagementCreate = z.infer<typeof engagementCreateSchema>;
export type EngagementUpdate = z.infer<typeof engagementUpdateSchema>;
