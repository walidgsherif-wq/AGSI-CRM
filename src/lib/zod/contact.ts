import { z } from 'zod';

const trimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null));

const optionalEmail = z
  .string()
  .trim()
  .email()
  .max(254)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v ?? null));

export const contactCreateSchema = z.object({
  company_id: z.string().uuid(),
  full_name: z.string().trim().min(1, 'Name is required').max(150),
  position: trimmedString(150),
  email: optionalEmail,
  phone: trimmedString(50),
  is_primary: z.boolean().default(false),
});

export const contactUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1, 'Name is required').max(150),
  position: trimmedString(150),
  email: optionalEmail,
  phone: trimmedString(50),
});

export type ContactCreate = z.infer<typeof contactCreateSchema>;
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;
