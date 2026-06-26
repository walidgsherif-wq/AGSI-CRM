import { z } from 'zod';

export const EVENT_TYPES = [
  'conference',
  'exhibition',
  'networking',
  'cpd',
  'other',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  conference: 'Conference',
  exhibition: 'Exhibition',
  networking: 'Networking',
  cpd: 'CPD',
  other: 'Other',
};

export const EVENT_STATUSES = ['planned', 'attended'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const trimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null));

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

const optionalProofPath = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

const requiredDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// Direct-log path: attended event, optionally with proof.
export const eventCreateSchema = z.object({
  event_name: z.string().trim().min(1, 'Event name is required').max(200),
  event_date: requiredDate,
  event_type: z.enum(EVENT_TYPES),
  website: optionalUrl,
  value_note: trimmedString(2000),
  feedback: trimmedString(2000),
  proof_path: optionalProofPath,
});

export const eventUpdateSchema = eventCreateSchema.extend({
  id: z.string().uuid(),
});

// Planned-event path: only the calendar fields. No value / feedback /
// proof yet — those come at confirm time.
export const plannedEventCreateSchema = z.object({
  event_name: z.string().trim().min(1, 'Event name is required').max(200),
  event_date: requiredDate,
  event_type: z.enum(EVENT_TYPES),
  website: optionalUrl,
});

// Confirm-attendance: takes a planned row to attended. Value + feedback
// are encouraged but not required; proof is optional but it's what
// promotes the row to Verified.
export const confirmAttendanceSchema = z.object({
  id: z.string().uuid(),
  value_note: trimmedString(2000),
  feedback: trimmedString(2000),
  proof_path: optionalProofPath,
});

export type EventCreate = z.infer<typeof eventCreateSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type PlannedEventCreate = z.infer<typeof plannedEventCreateSchema>;
export type ConfirmAttendance = z.infer<typeof confirmAttendanceSchema>;
