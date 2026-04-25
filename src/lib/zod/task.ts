import { z } from 'zod';

export const TASK_PRIORITIES = ['low', 'med', 'high', 'urgent'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
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

export const taskCreateSchema = z
  .object({
    company_id: optionalUuid,
    project_id: optionalUuid,
    title: z.string().trim().min(1, 'Title is required').max(300),
    description: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : v ?? null)),
    owner_id: z.string().uuid('Owner is required'),
    due_date: optionalDate,
    priority: z.enum(TASK_PRIORITIES).default('med'),
    status: z.enum(TASK_STATUSES).default('open'),
  })
  .refine((d) => d.company_id || d.project_id, {
    message: 'Task must be linked to a company or a project.',
    path: ['company_id'],
  });

export const taskUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null)),
  owner_id: z.string().uuid().optional(),
  due_date: optionalDate,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
