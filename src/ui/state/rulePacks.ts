/**
 * Where installed rule packs live.
 *
 * Packs are data, and they are kept in local storage beside the library index
 * rather than inside any one universe. Every load goes through the same
 * validator as an imported file, so a hand-edited or truncated value cannot
 * reach the engine. A pack that fails validation is skipped and reported; it is
 * never silently repaired into something the person did not write.
 */
import type { RulePack } from '../../core/rulePack';
import { PACK_LIMITS, parsePackValue } from '../../core/customPacks';
import { setCustomPacks } from '../../core/packs';

export const LS_PACKS = 'whatifs:packs:v1';

export interface InstalledPacks {
  packs: RulePack[];
  errors: string[];
}

export function loadInstalledPacks(): InstalledPacks {
  let raw: string | null = null;
  // The store is exercised from Node in the unit tests, where local storage
  // does not exist. That is not a failure worth telling the person about.
  if (typeof localStorage === 'undefined') return { packs: [], errors: [] };
  try {
    raw = localStorage.getItem(LS_PACKS);
  } catch {
    return {
      packs: [],
      errors: ['Local storage is unavailable, so saved rule packs could not be loaded.'],
    };
  }
  if (!raw) return { packs: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { packs: [], errors: ['The saved rule packs are not valid JSON and were not loaded.'] };
  }
  if (!Array.isArray(parsed)) {
    return { packs: [], errors: ['The saved rule packs were not a list and were not loaded.'] };
  }

  const packs: RulePack[] = [];
  const errors: string[] = [];
  if (parsed.length > PACK_LIMITS.maxPacks) {
    errors.push(`Only the first ${PACK_LIMITS.maxPacks} saved packs were loaded.`);
  }

  for (let i = 0; i < Math.min(parsed.length, PACK_LIMITS.maxPacks); i += 1) {
    const result = parsePackValue(parsed[i], {
      existingPackIds: packs.map((p) => p.id),
      existingRuleIds: packs.flatMap((p) => p.rules.map((r) => r.id)),
    });
    if (result.ok) {
      packs.push(result.pack);
    } else {
      errors.push(`Saved pack ${i + 1} was skipped: ${result.errors[0] ?? 'invalid pack'}`);
    }
  }

  return { packs, errors };
}

export function saveInstalledPacks(packs: readonly RulePack[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(LS_PACKS, JSON.stringify(packs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies saved packs to the runtime catalogue before the first universe is
 * generated.
 *
 * The renderer boots a universe before it constructs the store, so without
 * this the first window of a session would ignore every installed pack. The
 * store repeats the load so a store created directly (in tests, or from
 * another entry point) still gets the same catalogue.
 */
export function bootstrapInstalledPacks(): string[] {
  const installed = loadInstalledPacks();
  try {
    setCustomPacks(installed.packs);
  } catch (error) {
    return [
      ...installed.errors,
      `Saved packs were not loaded: ${error instanceof Error ? error.message : 'invalid pack'}.`,
    ];
  }
  return installed.errors;
}
