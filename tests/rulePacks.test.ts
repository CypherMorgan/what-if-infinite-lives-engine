/**
 * Rule-pack tests.
 *
 * A pack is user input that changes what the engine can say, so the tests are
 * in two parts: the validator must reject malformed files precisely, and a
 * valid pack must actually reach the engine rather than merely parse.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_VARS } from '../src/core/packs/vars';
import {
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  PACK_LIMITS,
  packIds,
  parsePackFile,
  parsePackValue,
} from '../src/core/customPacks';
import { ALL_PACKS, getActivePacks, setCustomPacks } from '../src/core/packs';
import { activeRules, createUniverse, expandNode } from '../src/core/engine';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';
import type { RulePack } from '../src/core/rulePack';

const EXAMPLE = path.join(process.cwd(), 'examples', 'sabbatical.whatif-pack.json');

const prompt: ScenarioPrompt = {
  situation: 'I am considering leaving a steady job for a year to build something of my own.',
  decision: 'Should I stay, take a sabbatical, or leave now?',
  goals: ['more control over my time'],
  constraints: ['mortgage'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.3,
  resources: ['savings 18000'],
  archetypes: ['career'],
  title: 'Stay or build?',
};

function baseRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'custom.test.a-step',
    label: 'A step',
    summary: 'Something plausible happens.',
    type: 'event',
    requires: ['career'],
    when: {},
    weight: 5,
    monthsMin: 0,
    monthsMax: 24,
    durationMonths: 1,
    effects: [{ key: 'money', op: 'add', value: -100, reason: 'a modelled cost' }],
    evidence: [{ cls: 'assumption', text: 'A stated modelling choice.' }],
    ...overrides,
  };
}

function basePack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'custom.test',
    name: 'The test pack',
    description: 'Rules used by the test suite.',
    rules: [baseRule()],
    ...overrides,
  };
}

function envelope(pack: Record<string, unknown> = basePack()): string {
  return JSON.stringify({ format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, pack });
}

function errorsOf(text: string, options = {}): string[] {
  const result = parsePackFile(text, options);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

afterEach(() => {
  // The catalogue is process-wide, so a test that installs a pack must not
  // change the next one.
  setCustomPacks([]);
});

describe('Rule packs — the bundled example', () => {
  it('parses, and every rule is namespaced by the pack id', () => {
    const result = parsePackFile(readFileSync(EXAMPLE, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.id).toBe('custom.sabbatical');
    expect(result.pack.rules).toHaveLength(3);
    for (const rule of result.pack.rules) {
      expect(rule.id.startsWith('custom.sabbatical.')).toBe(true);
      expect(rule.requires).toEqual(['career']);
      expect(rule.evidence.length).toBeGreaterThan(0);
    }
  });

  it('only uses variables the app models', () => {
    const result = parsePackFile(readFileSync(EXAMPLE, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const known = new Set(ALL_VARS.map((v) => v.key));
    for (const rule of result.pack.rules) {
      for (const effect of rule.effects) {
        expect(known.has(effect.key)).toBe(true);
        if (effect.from) expect(known.has(effect.from)).toBe(true);
      }
      const conditions = [
        ...(rule.when.all ?? []),
        ...(rule.when.any ?? []),
        ...(rule.when.none ?? []),
      ];
      for (const condition of conditions) expect(known.has(condition.key)).toBe(true);
    }
  });

  it('activates for career and stays out of unrelated archetypes', () => {
    const parsed = parsePackFile(readFileSync(EXAMPLE, 'utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    setCustomPacks([parsed.pack]);
    const career = activeRules(getActivePacks(), ['career']);
    const health = activeRules(getActivePacks(), ['health']);
    expect(career.some((r) => r.id.startsWith('custom.sabbatical.'))).toBe(true);
    expect(health.some((r) => r.id.startsWith('custom.sabbatical.'))).toBe(false);
  });

  it('is actually selected by the engine, not just accepted', () => {
    const parsed = parsePackFile(readFileSync(EXAMPLE, 'utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    setCustomPacks([parsed.pack]);
    const doc = createUniverse({ packs: getActivePacks(), seed: 9, prompt });
    const target = Object.values(doc.nodes).find((n) => n.expandable && !n.expanded);
    expect(target).toBeDefined();
    if (!target) return;

    // A forced, broad, very heavy rule is the only reliable way to assert that
    // a data-only rule can be selected without depending on the weight draw.
    const heavy = parsePackValue(
      basePack({
        id: 'custom.heavy',
        rules: [
          baseRule({
            id: 'custom.heavy.always',
            label: 'The custom rule',
            weight: 100,
          }),
        ],
      }),
      { existingPackIds: ['custom.sabbatical'] }
    );
    expect(heavy.ok).toBe(true);
    if (!heavy.ok) return;
    setCustomPacks([parsed.pack, heavy.pack]);

    const { doc: expanded, added } = expandNode(doc, target.id, getActivePacks());
    const used = added
      .map((id) => expanded.nodes[id]?.ruleId)
      .filter((id): id is string => typeof id === 'string');
    expect(used.some((id) => id.startsWith('custom.heavy.'))).toBe(true);
  });
});

describe('Rule packs — the envelope', () => {
  it('rejects text that is not JSON', () => {
    expect(errorsOf('{ nope').join(' ')).toContain('not valid JSON');
  });

  it('rejects a file that is not an object', () => {
    expect(errorsOf('[]').join(' ')).toContain('JSON object');
  });

  it('requires the exact format and version', () => {
    expect(
      errorsOf(
        JSON.stringify({ format: 'something.else', formatVersion: 1, pack: basePack() })
      ).join(' ')
    ).toContain('file.format');
    expect(
      errorsOf(JSON.stringify({ format: PACK_FORMAT, formatVersion: 2, pack: basePack() })).join(
        ' '
      )
    ).toContain('file.formatVersion');
  });

  it('reports an unknown envelope field instead of ignoring it', () => {
    const text = JSON.stringify({
      format: PACK_FORMAT,
      formatVersion: PACK_FORMAT_VERSION,
      pack: basePack(),
      generatedBy: 'something',
    });
    expect(errorsOf(text).join(' ')).toContain('unknown field "generatedBy"');
  });

  it('rejects a file over the size limit before parsing it', () => {
    const text = 'x'.repeat(PACK_LIMITS.maxFileBytes + 1);
    expect(errorsOf(text).join(' ')).toContain('larger than');
  });
});

describe('Rule packs — pack and rule identity', () => {
  it('requires a custom. id', () => {
    expect(errorsOf(envelope(basePack({ id: 'sabbatical' }))).join(' ')).toContain(
      'must start with "custom."'
    );
  });

  it('rejects an id already used by a built-in pack', () => {
    const builtIn = ALL_PACKS[0];
    expect(builtIn).toBeDefined();
    if (!builtIn) return;
    expect(errorsOf(envelope(basePack({ id: builtIn.id }))).join(' ')).toContain('built-in pack');
  });

  it('rejects an id that is already installed', () => {
    const errors = errorsOf(envelope(), { existingPackIds: ['custom.test'] });
    expect(errors.join(' ')).toContain('already installed');
  });

  it('requires a rule id namespaced by the pack id', () => {
    const errors = errorsOf(
      envelope(basePack({ rules: [baseRule({ id: 'custom.other.a-step' })] }))
    );
    expect(errors.join(' ')).toContain('must start with "custom.test."');
  });

  it('rejects a rule id that already exists', () => {
    const errors = errorsOf(envelope(), { existingRuleIds: ['custom.test.a-step'] });
    expect(errors.join(' ')).toContain('already exists');
  });

  it('rejects two rules with the same id inside one pack', () => {
    const errors = errorsOf(
      envelope(basePack({ rules: [baseRule(), baseRule({ label: 'Again' })] }))
    );
    expect(errors.join(' ')).toContain('already exists');
  });

  it('rejects a duplicate rule id at the group level', () => {
    const pack = parsePackValue(basePack());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    expect(packIds(pack.pack)).toEqual({
      packId: 'custom.test',
      ruleIds: ['custom.test.a-step'],
    });
    expect(() => setCustomPacks([pack.pack, pack.pack])).toThrow(/already in use/);
  });
});

describe('Rule packs — conditions, effects and evidence', () => {
  it('rejects a condition on a variable the app does not model', () => {
    const errors = errorsOf(
      envelope(
        basePack({
          rules: [
            baseRule({
              when: { all: [{ key: 'madeUpThing', op: '>', value: 1 }] },
            }),
          ],
        })
      )
    );
    expect(errors.join(' ')).toContain('is not a variable this app models');
  });

  it('rejects an unknown operator, effect op, or missing reason', () => {
    expect(
      errorsOf(
        envelope(
          basePack({
            rules: [baseRule({ when: { all: [{ key: 'money', op: '~', value: 1 }] } })],
          })
        )
      ).join(' ')
    ).toContain('op must be one of');

    expect(
      errorsOf(
        envelope(
          basePack({
            rules: [
              baseRule({ effects: [{ key: 'money', op: 'explode', value: 1, reason: 'no' }] }),
            ],
          })
        )
      ).join(' ')
    ).toContain('op must be one of');

    expect(
      errorsOf(
        envelope(
          basePack({ rules: [baseRule({ effects: [{ key: 'money', op: 'add', value: 1 }] })] })
        )
      ).join(' ')
    ).toContain('reason must be a string');
  });

  it('rejects a rule with no effects and a rule with no evidence', () => {
    expect(
      errorsOf(envelope(basePack({ rules: [baseRule({ effects: [] })] }))).join(' ')
    ).toContain('at least one change');
    expect(
      errorsOf(envelope(basePack({ rules: [baseRule({ evidence: [] })] }))).join(' ')
    ).toContain('must contain at least one tag');
  });

  it('rejects an effect whose value is missing for add/set/mul', () => {
    const errors = errorsOf(
      envelope(
        basePack({
          rules: [baseRule({ effects: [{ key: 'money', op: 'add', reason: 'no value' }] })],
        })
      )
    );
    expect(errors.join(' ')).toContain('value is required');
  });

  it('rejects a noise outside the relative range', () => {
    const errors = errorsOf(
      envelope(
        basePack({
          rules: [
            baseRule({
              effects: [{ key: 'money', op: 'add', value: -1, noise: 4, reason: 'too noisy' }],
            }),
          ],
        })
      )
    );
    expect(errors.join(' ')).toContain('between 0 and 1');
  });
});

describe('Rule packs — deliberate limits', () => {
  it('requires at least one known archetype', () => {
    expect(
      errorsOf(envelope(basePack({ rules: [baseRule({ requires: [] })] }))).join(' ')
    ).toContain('at least one archetype');
    expect(
      errorsOf(envelope(basePack({ rules: [baseRule({ requires: ['cooking'] })] }))).join(' ')
    ).toContain('not a known archetype');
  });

  it('refuses new variables and starting modifiers', () => {
    expect(
      errorsOf(
        envelope(
          basePack({
            vars: [
              {
                key: 'luck',
                label: 'Luck',
                unit: 'level',
                kind: 'capacity',
                direction: 'up',
                domain: 'personal',
              },
            ],
          })
        )
      ).join(' ')
    ).toContain('pack.vars is not supported yet');
    expect(
      errorsOf(
        envelope(
          basePack({ startingModifiers: [{ key: 'money', op: 'add', value: 1, reason: 'x' }] })
        )
      ).join(' ')
    ).toContain('pack.startingModifiers is not supported yet');
  });

  it('refuses a rule-defined decision instead of accepting a question that never appears', () => {
    const errors = errorsOf(
      envelope(
        basePack({
          rules: [
            baseRule({
              decision: {
                question: 'What next?',
                options: [
                  { id: 'a', label: 'A' },
                  { id: 'b', label: 'B' },
                ],
              },
            }),
          ],
        })
      )
    );
    expect(errors.join(' ')).toContain('decision is not supported yet');
  });

  it('enforces the per-pack rule limit', () => {
    const rules = Array.from({ length: PACK_LIMITS.maxRulesPerPack + 1 }, (_, i) =>
      baseRule({ id: `custom.test.rule-${i}` })
    );
    expect(errorsOf(envelope(basePack({ rules }))).join(' ')).toContain(
      `more than ${PACK_LIMITS.maxRulesPerPack} rules`
    );
  });

  it('enforces the total custom-rule limit', () => {
    const existingRuleIds = Array.from(
      { length: PACK_LIMITS.maxTotalRules },
      (_, i) => `custom.other.rule-${i}`
    );
    const errors = errorsOf(envelope(), { existingRuleIds });
    expect(errors.join(' ')).toContain('would exceed');
  });

  it('rejects an unknown field in a rule instead of guessing', () => {
    const errors = errorsOf(envelope(basePack({ rules: [baseRule({ effect: [] })] })));
    expect(errors.join(' ')).toContain('unknown field "effect"');
  });
});

describe('Rule packs — the runtime catalogue', () => {
  it('keeps the built-in catalogue immutable when packs are set', () => {
    const before = ALL_PACKS.length;
    const pack = parsePackValue(basePack());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    setCustomPacks([pack.pack]);
    expect(ALL_PACKS).toHaveLength(before);
    expect(getActivePacks()).toHaveLength(before + 1);
    expect(getActivePacks().at(-1)).toBe(pack.pack);
  });

  it('a universe built with a pack records the rule that produced a node', () => {
    const pack = parsePackValue(
      basePack({
        rules: [
          baseRule({
            id: 'custom.test.always',
            label: 'The one custom rule',
            weight: 100,
          }),
        ],
      })
    );
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    setCustomPacks([pack.pack]);
    const doc: SimulationDoc = createUniverse({
      packs: getActivePacks(),
      seed: 12,
      prompt,
    });
    const target = Object.values(doc.nodes).find((n) => n.expandable && !n.expanded);
    expect(target).toBeDefined();
    if (!target) return;
    const { doc: expanded, added } = expandNode(doc, target.id, getActivePacks());
    expect(added.length).toBeGreaterThan(0);
    const used = added
      .map((id) => expanded.nodes[id]?.ruleId)
      .filter((id): id is string => typeof id === 'string');
    expect(used).toContain('custom.test.always');
  });
});

describe('Rule packs — the RulePack type', () => {
  it('a parsed pack is plain data with no functions', () => {
    const parsed = parsePackFile(readFileSync(EXAMPLE, 'utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pack: RulePack = parsed.pack;
    const walk = (value: unknown): void => {
      if (typeof value === 'function') throw new Error('a pack must not contain functions');
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(pack);
  });
});
