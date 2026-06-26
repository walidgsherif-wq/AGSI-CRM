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

const requiredDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const eventCreateSchema = z.object({
  event_name: z.string().trim().min(1, 'Event name is required').max(200),
  event_date: requiredDate,
  event_type: z.enum(EVENT_TYPES),
  website: optionalUrl,
  value_note: trimmedString(2000),
  feedback: trimmedString(2000),
});

export const eventUpdateSchema = eventCreateSchema.extend({
  id: z.string().uuid(),
});

export type EventCreate = z.infer<typeof eventCreateSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
