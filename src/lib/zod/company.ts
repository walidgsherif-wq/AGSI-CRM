import { z } from 'zod';

const COMPANY_TYPES = [
  'developer',
  'design_consultant',
  'main_contractor',
  'mep_consultant',
  'mep_contractor',
  'authority',
  'other',
] as const;

const trimmedString = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal('')).transform((v) => (v === '' ? null : v ?? null));

const optionalEmail = z
  .string()
  .trim()
  .email()
  .max(254)
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

export const companyCreateSchema = z.object({
  canonical_name: z.string().trim().min(1, 'Name is required').max(200),
  company_type: z.enum(COMPANY_TYPES),
  country: z.string().trim().max(100).default('United Arab Emirates'),
  city: trimmedString(100),
  phone: trimmedString(50),
  email: optionalEmail,
  website: optionalUrl,
  key_contact_name: trimmedString(150),
  key_contact_role: trimmedString(150),
  key_contact_email: optionalEmail,
  key_contact_phone: trimmedString(50),
  notes_internal: trimmedString(4000),
  is_key_stakeholder: z.boolean().default(false),
  owner_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v ?? null)),
});

export const companyUpdateSchema = companyCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export type CompanyCreate = z.infer<typeof companyCreateSchema>;
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;

export { COMPANY_TYPES };

export const COMPANY_TYPE_LABEL: Record<(typeof COMPANY_TYPES)[number], string> = {
  developer: 'Developer',
  design_consultant: 'Design Consultant',
  main_contractor: 'Main Contractor',
  mep_consultant: 'MEP Consultant',
  mep_contractor: 'MEP Contractor',
  authority: 'Authority',
  other: 'Other',
};
