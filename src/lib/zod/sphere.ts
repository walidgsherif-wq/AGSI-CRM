import { z } from 'zod';
import { COMPANY_TYPE_LABEL } from '@/lib/zod/company';

export const SPHERE_SORT_KEYS = [
  'value_involved',
  'project_count',
  'name',
] as const;
export type SphereSortKey = (typeof SPHERE_SORT_KEYS)[number];

export const SPHERE_SORT_DIRS = ['asc', 'desc'] as const;
export type SphereSortDir = (typeof SPHERE_SORT_DIRS)[number];

export const SPHERE_IN_FILTERS = ['all', 'in', 'out'] as const;
export type SphereInFilter = (typeof SPHERE_IN_FILTERS)[number];

const COMPANY_TYPES = Object.keys(COMPANY_TYPE_LABEL) as [string, ...string[]];

export const sphereQuerySchema = z.object({
  sort: z.enum(SPHERE_SORT_KEYS).default('value_involved'),
  dir: z.enum(SPHERE_SORT_DIRS).default('desc'),
  in: z.enum(SPHERE_IN_FILTERS).default('all'),
  type: z.enum(COMPANY_TYPES).optional(),
  city: z.string().trim().min(1).optional(),
  owner: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // New: server-side minimums so the top-value / top-count views can
  // be trimmed to a floor without in-memory filtering. Coerced from
  // URL strings, min 0, silently dropped when empty.
  min_value: z.coerce.number().min(0).optional().catch(undefined),
  min_count: z.coerce.number().int().min(0).optional().catch(undefined),
  // Filter on the LARGEST SINGLE project the stakeholder is on
  // (max_project_value in the view, 0100). Distinct from
  // min_value which sums every project. Answers "does this
  // stakeholder touch at least one deal ≥ X?" — the aggregate
  // can't (an owner of 200 tiny projects can outrank a single-
  // huge-project owner on the sum but never on the max).
  min_single_project_value: z
    .coerce.number()
    .min(0)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
});

export type SphereQuery = z.infer<typeof sphereQuerySchema>;

export const PAGE_SIZE = 50;
