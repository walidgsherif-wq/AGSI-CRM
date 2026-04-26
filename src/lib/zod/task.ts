import { z } from 'zod';

export const TASK_PRIORITIES = ['low', 'med', 'high', 'urgent'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const REMINDER_KINDS = ['at_due', '1d_before', '1w_before', '1m_before', 'custom'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type ReminderKind = (typeof REMINDER_KINDS)[number];

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

export const REMINDER_KIND_LABEL: Record<ReminderKind, string> = {
  at_due: 'On the due date',
  '1d_before': '1 day before',
  '1w_before': '1 week before',
  '1m_before': '1 month before',
  custom: 'Custom date & time',
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

const optionalDescription = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

export const taskCreateSchema = z
  .object({
    company_id: optionalUuid,
    project_id: optionalUuid,
    title: z.string().trim().min(1, 'Title is required').max(300),
    description: optionalDescription,
    owner_id: z.string().uuid('Owner is required'),
    due_date: optionalDate,
    priority: z.enum(TASK_PRIORITIES).default('med'),
    status: z.enum(TASK_STATUSES).default('open'),
    reminder_kinds: z.array(z.enum(REMINDER_KINDS)).default([]),
    reminder_custom_at: z
      .string()
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : v ?? null)),
  })
  .refine((d) => d.company_id || d.project_id, {
    message: 'Task must be linked to a company or a project.',
    path: ['company_id'],
  })
  .refine(
    (d) =>
      !d.reminder_kinds.includes('custom') ||
      (typeof d.reminder_custom_at === 'string' && d.reminder_custom_at.length > 0),
    { message: 'Custom reminder requires a date & time.', path: ['reminder_custom_at'] },
  )
  .refine(
    (d) =>
      d.reminder_kinds.length === 0 ||
      d.due_date ||
      (d.reminder_kinds.length === 1 && d.reminder_kinds[0] === 'custom'),
    {
      message: 'Set a due date to use the on-due/1-day/1-week/1-month reminders.',
      path: ['reminder_kinds'],
    },
  );

export const taskUpdateSchema = z.object({
  id: z.string().uuid(),
  company_id: optionalUuid,
  project_id: optionalUuid,
  title: z.string().trim().min(1).max(300).optional(),
  description: optionalDescription,
  owner_id: z.string().uuid().optional(),
  due_date: optionalDate,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  reminder_kinds: z.array(z.enum(REMINDER_KINDS)).optional(),
  reminder_custom_at: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null)),
});

export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

/**
 * Compute the absolute timestamp at which a reminder should fire.
 * Reminders default to 09:00 Asia/Dubai on the offset date.
 */
export function computeReminderAt(
  kind: ReminderKind,
  dueDate: string | null,
  customAt: string | null,
): string | null {
  if (kind === 'custom') {
    if (!customAt) return null;
    // Parse the datetime-local input as Asia/Dubai then convert to UTC ISO.
    return new Date(customAt).toISOString();
  }
  if (!dueDate) return null;
  // due_date is YYYY-MM-DD. We want 09:00 Asia/Dubai on (dueDate - offset).
  // Asia/Dubai is UTC+4 with no DST, so 09:00 local = 05:00 UTC.
  const [y, m, d] = dueDate.split('-').map((s) => parseInt(s, 10));
  const target = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
  if (kind === '1d_before') target.setUTCDate(target.getUTCDate() - 1);
  if (kind === '1w_before') target.setUTCDate(target.getUTCDate() - 7);
  if (kind === '1m_before') target.setUTCMonth(target.getUTCMonth() - 1);
  return target.toISOString();
}
