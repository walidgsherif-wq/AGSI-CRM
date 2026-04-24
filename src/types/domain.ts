// Hand-written domain types. The generated Supabase types will live in
// src/lib/supabase/types.ts once the DB is provisioned (M2). Until then,
// these types mirror the enums defined in supabase/migrations/0002_enums.sql.

export type Role = 'admin' | 'leadership' | 'bd_head' | 'bd_manager';

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export type CompanyType =
  | 'developer'
  | 'design_consultant'
  | 'main_contractor'
  | 'mep_consultant'
  | 'mep_contractor'
  | 'authority'
  | 'other';

export type ProjectStage =
  | 'concept'
  | 'design'
  | 'tender'
  | 'tender_submission'
  | 'tender_evaluation'
  | 'under_construction'
  | 'completed'
  | 'on_hold'
  | 'cancelled';

export type Driver = 'A' | 'B' | 'C' | 'D';

export const ROLES: readonly Role[] = [
  'admin',
  'leadership',
  'bd_head',
  'bd_manager',
] as const;

export const LEVELS: readonly Level[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  leadership: 'Leadership',
  bd_head: 'BD Head',
  bd_manager: 'BD Manager',
};
