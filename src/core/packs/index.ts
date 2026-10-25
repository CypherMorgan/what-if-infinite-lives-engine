/**
 * The rule catalogue.
 *
 * The base pack contributes dynamics that apply everywhere; each archetype pack contributes
 * the domain-specific events and their variables. The engine filters archetype packs by the
 * `requires` field on each rule against the archetypes detected in a scenario.
 *
 * `ALL_PACKS` is the built-in catalogue and never changes. A person can install data-only
 * packs at runtime; those live beside it through `getActivePacks()`, so the built-in ids stay
 * stable for tests, diagnostics and the pack validator.
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

/** The built-in catalogue. Always on; custom packs are added beside it. */
export const ALL_PACKS: RulePack[] = [BASE_PACK, ...ARCHETYPE_PACKS];

let activePacks: readonly RulePack[] = ALL_PACKS;

/** The catalogue the engine should use: built-ins first, then installed packs. */
export function getActivePacks(): readonly RulePack[] {
  return activePacks;
}

/**
 * Replaces the installed packs.
 *
 * Validation happens before this is called, but the guard is repeated here because
 * a duplicate id would silently shadow a built-in rule: `activeRules` skips a rule id it has
 * already seen, so the built-in would win and the custom rule would simply never fire.
 */
export function setCustomPacks(packs: readonly RulePack[]): void {
  const packIds = new Set(ALL_PACKS.map((p) => p.id));
  const ruleIds = new Set(allRuleIds());
  for (const pack of packs) {
    if (packIds.has(pack.id)) throw new Error(`Pack id "${pack.id}" is already in use.`);
    packIds.add(pack.id);
    for (const rule of pack.rules) {
      if (ruleIds.has(rule.id)) throw new Error(`Rule id "${rule.id}" is already in use.`);
      ruleIds.add(rule.id);
    }
  }
  activePacks = [...ALL_PACKS, ...packs];
}

/** All rule ids that exist in the built-in catalogue, for duplicate detection. */
export function allRuleIds(): string[] {
  return ALL_PACKS.flatMap((p) => p.rules.map((r) => r.id));
}

/** All built-in variable keys declared anywhere, for validation. */
export function allVarKeys(): string[] {
  return ALL_PACKS.flatMap((p) => p.vars.map((v) => v.key));
}

export { BASE_PACK };
export { ARCHETYPES };
