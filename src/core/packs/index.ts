/**
 * The rule catalogue.
 *
 * The base pack contributes dynamics that apply everywhere; each archetype pack contributes
 * the domain-specific events and their variables. The engine filters archetype packs by the
 * `requires` field on each rule against the archetypes detected in a scenario.
 */
import { BASE_PACK } from './base';
import { EDUCATION_PACK } from './education';
import { LEARNING_PACK } from './learning';
import { CAREER_PACK } from './career';
import { BUSINESS_PACK } from './business';
import { RELOCATION_PACK } from './relocation';
import { CREATIVE_PACK } from './creative';
import { FINANCE_PACK } from './finance';
import { HEALTH_PACK } from './health';
import { RELATIONSHIPS_PACK } from './relationships';
import { TIME_PACK } from './time';
import { UNCERTAINTY_PACK } from './uncertainty';
import { ARCHETYPES } from '../archetypes';
import type { RulePack } from '../rulePack';

export const ARCHETYPE_PACKS: RulePack[] = [
  EDUCATION_PACK,
  LEARNING_PACK,
  CAREER_PACK,
  BUSINESS_PACK,
  RELOCATION_PACK,
  CREATIVE_PACK,
  FINANCE_PACK,
  HEALTH_PACK,
  RELATIONSHIPS_PACK,
  TIME_PACK,
  UNCERTAINTY_PACK,
];

export const ALL_PACKS: RulePack[] = [BASE_PACK, ...ARCHETYPE_PACKS];

/** All rule ids that exist anywhere, for duplicate detection in tests and diagnostics. */
export function allRuleIds(): string[] {
  return ALL_PACKS.flatMap((p) => p.rules.map((r) => r.id));
}

/** All variable keys declared anywhere, for validation. */
export function allVarKeys(): string[] {
  return ALL_PACKS.flatMap((p) => p.vars.map((v) => v.key));
}

export { BASE_PACK };
export { ARCHETYPES };
