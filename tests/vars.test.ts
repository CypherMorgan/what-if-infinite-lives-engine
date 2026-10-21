/**
 * Variable registry tests.
 *
 * The registry is the shared vocabulary between the engine and the UI. A
 * duplicated key there is not a cosmetic problem: the second definition
 * silently wins in the lookup map, the first becomes unreachable, and every
 * list built from the registry renders the same entry twice.
 */
import { describe, expect, it } from 'vitest';
import { ALL_VARS, VAR_BY_KEY, varDef } from '../src/core/packs/vars';
import { ALL_PACKS, allVarKeys } from '../src/core/packs';

describe('variable registry', () => {
  it('declares every key exactly once', () => {
    const counts = new Map<string, number>();
    for (const v of ALL_VARS) counts.set(v.key, (counts.get(v.key) ?? 0) + 1);
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
    expect(duplicates).toEqual([]);
  });

  it('keeps the lookup map in step with the registry', () => {
    expect(VAR_BY_KEY.size).toBe(ALL_VARS.length);
    for (const v of ALL_VARS) {
      expect(varDef(v.key)).toBeDefined();
      expect(varDef(v.key)?.label).toBe(v.label);
    }
  });

  it('covers every key the packs declare', () => {
    for (const key of allVarKeys()) {
      expect(varDef(key), `pack declares "${key}" but the registry does not`).toBeDefined();
    }
  });

  it('has no duplicate keys inside a single pack', () => {
    for (const pack of ALL_PACKS) {
      const keys = pack.vars.map((v) => v.key);
      expect(new Set(keys).size, `pack ${pack.id} declares a duplicate key`).toBe(keys.length);
    }
  });

  it('gives every variable a label, a unit and a direction', () => {
    for (const v of ALL_VARS) {
      expect(v.key.length).toBeGreaterThan(0);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.unit.length).toBeGreaterThan(0);
      expect(['up', 'down']).toContain(v.direction);
    }
  });
});
