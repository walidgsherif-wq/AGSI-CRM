import { z } from 'zod';

const PROJECT_STAGES = [
  'concept',
  'design',
  'tender',
  'tender_submission',
  'tender_evaluation',
  'under_construction',
  'completed',
  'on_hold',
  'cancelled',
] as const;

const PROJECT_PRIORITIES = ['tier_1', 'tier_2', 'tier_3', 'watchlist'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null));

const optionalNumber = (min?: number, max?: number) =>
  z
    .preprocess(
      (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
      z.number().nullable(),
    )
    .refine(
      (v) => v === null || (min === undefined || v >= min) && (max === undefined || v <= max),
      { message: 'Out of range' },
    );

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(300),
  project_type: optionalText(100),
  stage: z.enum(PROJECT_STAGES).default('concept'),
  value_aed: optionalNumber(0),
  value_usd: optionalNumber(0),
  city: optionalText(100),
  location: optionalText(300),
  sector: optionalText(100),
  industry: optionalText(100),
  estimated_completion_date: optionalDate,
  completion_percentage: optionalNumber(0, 100),
  agsi_priority: z
    .enum(PROJECT_PRIORITIES)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null)),
  agsi_internal_notes: optionalText(4000),
});

export const projectUpdateSchema = projectCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

export { PROJECT_STAGES, PROJECT_PRIORITIES };

export const PROJECT_STAGE_LABEL: Record<(typeof PROJECT_STAGES)[number], string> = {
  concept: 'Concept',
  design: 'Design',
  tender: 'Tender',
  tender_submission: 'Tender — submission',
  tender_evaluation: 'Tender — evaluation',
  under_construction: 'Under construction',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

export const PROJECT_PRIORITY_LABEL: Record<(typeof PROJECT_PRIORITIES)[number], string> = {
  tier_1: 'Tier 1',
  tier_2: 'Tier 2',
  tier_3: 'Tier 3',
  watchlist: 'Watchlist',
};
