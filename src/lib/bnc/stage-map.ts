// BNC "Stage" string → projects.stage enum.
// Case-insensitive, whitespace/punct insensitive.

import type { ProjectStage } from '@/types/domain';

const RULES: Array<{ match: RegExp; stage: ProjectStage }> = [
  { match: /\bunder\s*construction\b/i, stage: 'under_construction' },
  { match: /\bcompleted?\b/i, stage: 'completed' },
  { match: /\bon\s*hold\b/i, stage: 'on_hold' },
  { match: /\bcancell?ed\b/i, stage: 'cancelled' },
  { match: /\btender\s*evaluation\b/i, stage: 'tender_evaluation' },
  { match: /\btender\s*submission\b|\bbidding\b/i, stage: 'tender_submission' },
  { match: /\btender\b/i, stage: 'tender' },
  // Design family — order matters (more specific first)
  { match: /\b(detailed|schematic)?\s*design\b/i, stage: 'design' },
  { match: /\bconcept(ual)?\b/i, stage: 'concept' },
];

export function mapStage(raw: string | null | undefined): {
  stage: ProjectStage;
  warning: string | null;
} {
  const value = (raw ?? '').trim();
  if (!value) return { stage: 'concept', warning: 'empty' };
  for (const r of RULES) {
    if (r.match.test(value)) return { stage: r.stage, warning: null };
  }
  return { stage: 'concept', warning: `unknown:${value}` };
}
