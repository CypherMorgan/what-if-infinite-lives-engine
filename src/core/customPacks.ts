/**
 * Authorable rule packs.
 *
 * A pack is plain data. It can describe new events, opportunities, setbacks and
 * decisions over the variables the app already models, and the same engine that
 * runs the built-in catalogue runs it. Nothing in a pack is executable, and a
 * pack cannot introduce a new state variable yet — that is a deliberate limit,
 * because a key the UI and the export format do not know about would be shown
 * without a unit, a direction or a name.
 *
 * Validation is strict about structure: an unknown field is a typo worth
 * reporting, not something to ignore, and a rule whose condition names a key
 * that does not exist would silently never fire. The limits exist so a
 * hand-written or generated file cannot make a universe unreasonably large.
 */
import type { EvidenceClass, EvidenceTag, NodeType } from './types';
import type { Condition, Effect, Rule, RulePack, RuleWhen } from './rulePack';
import { allRuleIds, ALL_PACKS } from './packs';
import { ALL_VARS } from './packs/vars';
import { ARCHETYPES } from './archetypes';

export const PACK_FORMAT = 'whatif.rulepack';
export const PACK_FORMAT_VERSION = 1;

export const PACK_LIMITS = {
  /** Larger files are rejected before parsing. */
  maxFileBytes: 256 * 1024,
  maxPacks: 10,
  maxRulesPerPack: 100,
  maxTotalRules: 300,
  maxConditions: 20,
  maxEffects: 12,
  maxName: 80,
  maxDescription: 600,
  maxLabel: 140,
  maxSummary: 700,
  maxDetail: 2400,
  maxReason: 220,
  maxListItem: 600,
  maxListItems: 12,
  maxEvidence: 6,
  maxEvidenceText: 600,
  maxMonths: 240,
} as const;

export interface PackParseOptions {
  /** Packs already installed, for id and rule-id collision checks. */
  existingPackIds?: readonly string[];
  existingRuleIds?: readonly string[];
}

export type PackParseResult = { ok: true; pack: RulePack } | { ok: false; errors: string[] };

type Dict = Record<string, unknown>;

const NODE_TYPES: readonly NodeType[] = [
  'start',
  'decision',
  'event',
  'opportunity',
  'setback',
  'milestone',
  'consequence',
  'alternative',
  'ending',
];

const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  'user-fact',
  'research',
  'assumption',
  'speculation',
];

const OPS = ['<', '<=', '>', '>=', '==', '!='] as const;
const EFFECT_OPS = ['add', 'set', 'mul', 'addFrom'] as const;

const PACK_ID = /^custom\.[a-z0-9][a-z0-9._-]{2,63}$/;
const RULE_SUFFIX = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reports unknown keys. A misspelled `effect` would otherwise be ignored. */
function checkKeys(value: Dict, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}: unknown field "${key}".`);
  }
}

function readString(
  value: unknown,
  path: string,
  errors: string[],
  min: number,
  max: number
): string | undefined {
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string.`);
    return undefined;
  }
  if (value.trim().length < min) {
    errors.push(`${path} must not be empty.`);
    return undefined;
  }
  if (value.length > max) {
    errors.push(`${path} is longer than ${max} characters.`);
    return undefined;
  }
  return value;
}

function readNumber(
  value: unknown,
  path: string,
  errors: string[],
  min: number,
  max: number,
  integer = false
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push(`${path} must be a whole number.`);
    return undefined;
  }
  if (value < min || value > max) {
    errors.push(`${path} must be between ${min} and ${max}.`);
    return undefined;
  }
  return value;
}

function readBool(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be true or false.`);
    return undefined;
  }
  return value;
}

function readStringList(
  value: unknown,
  path: string,
  errors: string[],
  maxItems: number,
  maxLen: number
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be a list of strings.`);
    return undefined;
  }
  if (value.length > maxItems) {
    errors.push(`${path} has more than ${maxItems} entries.`);
    return undefined;
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = readString(value[i], `${path}[${i}]`, errors, 1, maxLen);
    if (item !== undefined) out.push(item);
  }
  return out;
}

function readCondition(
  value: unknown,
  path: string,
  errors: string[],
  vars: Set<string>
): Condition | undefined {
  if (!isDict(value)) {
    errors.push(`${path} must be an object.`);
    return undefined;
  }
  checkKeys(value, ['key', 'op', 'value'], path, errors);
  const key = readString(value['key'], `${path}.key`, errors, 1, 80);
  if (key && !vars.has(key)) errors.push(`${path}.key "${key}" is not a variable this app models.`);
  const op = OPS.find((o) => o === value['op']);
  if (!op) errors.push(`${path}.op must be one of ${OPS.join(', ')}.`);
  const num = readNumber(value['value'], `${path}.value`, errors, -1e9, 1e9);
  if (!key || !op || num === undefined || !vars.has(key)) return undefined;
  return { key, op, value: num };
}

function readWhen(
  value: unknown,
  path: string,
  errors: string[],
  vars: Set<string>
): RuleWhen | undefined {
  if (!isDict(value)) {
    errors.push(`${path} must be an object with all/any/none lists.`);
    return undefined;
  }
  checkKeys(value, ['all', 'any', 'none'], path, errors);
  const when: RuleWhen = {};
  for (const kind of ['all', 'any', 'none'] as const) {
    const raw = value[kind];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      errors.push(`${path}.${kind} must be a list.`);
      continue;
    }
    if (raw.length > PACK_LIMITS.maxConditions) {
      errors.push(`${path}.${kind} has more than ${PACK_LIMITS.maxConditions} conditions.`);
      continue;
    }
    const list: Condition[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const c = readCondition(raw[i], `${path}.${kind}[${i}]`, errors, vars);
      if (c) list.push(c);
    }
    if (list.length > 0) when[kind] = list;
  }
  return when;
}

function readEffect(
  value: unknown,
  path: string,
  errors: string[],
  vars: Set<string>
): Effect | undefined {
  if (!isDict(value)) {
    errors.push(`${path} must be an object.`);
    return undefined;
  }
  checkKeys(
    value,
    ['key', 'op', 'value', 'from', 'scale', 'noise', 'reason', 'clampMin', 'clampMax'],
    path,
    errors
  );

  const key = readString(value['key'], `${path}.key`, errors, 1, 80);
  if (key && !vars.has(key)) errors.push(`${path}.key "${key}" is not a variable this app models.`);

  const op = EFFECT_OPS.find((o) => o === value['op']);
  if (!op) errors.push(`${path}.op must be one of ${EFFECT_OPS.join(', ')}.`);

  const reason = readString(value['reason'], `${path}.reason`, errors, 1, PACK_LIMITS.maxReason);

  let num: number | undefined;
  if (value['value'] !== undefined) {
    num = readNumber(value['value'], `${path}.value`, errors, -1e9, 1e9);
  } else if (op === 'add' || op === 'set' || op === 'mul') {
    errors.push(`${path}.value is required for "${op}".`);
  }

  let from: string | undefined;
  if (value['from'] !== undefined) {
    from = readString(value['from'], `${path}.from`, errors, 1, 80);
    if (from && !vars.has(from))
      errors.push(`${path}.from "${from}" is not a variable this app models.`);
  }
  if (op === 'addFrom' && from === undefined)
    errors.push(`${path}.from is required for "addFrom".`);
  if (op !== 'addFrom' && from !== undefined)
    errors.push(`${path}.from is only valid for "addFrom".`);

  const scale =
    value['scale'] === undefined
      ? undefined
      : readNumber(value['scale'], `${path}.scale`, errors, -1e6, 1e6);
  const noise =
    value['noise'] === undefined
      ? undefined
      : readNumber(value['noise'], `${path}.noise`, errors, 0, 1);
  const clampMin =
    value['clampMin'] === undefined
      ? undefined
      : readNumber(value['clampMin'], `${path}.clampMin`, errors, -1e9, 1e9);
  const clampMax =
    value['clampMax'] === undefined
      ? undefined
      : readNumber(value['clampMax'], `${path}.clampMax`, errors, -1e9, 1e9);

  if (clampMin !== undefined && clampMax !== undefined && clampMin > clampMax) {
    errors.push(`${path}.clampMin must not be greater than clampMax.`);
  }

  if (!key || !op || !reason || !vars.has(key)) return undefined;

  const effect: Effect = { key, op, reason };
  if (num !== undefined) effect.value = num;
  if (from !== undefined) effect.from = from;
  if (scale !== undefined) effect.scale = scale;
  if (noise !== undefined) effect.noise = noise;
  if (clampMin !== undefined) effect.clampMin = clampMin;
  if (clampMax !== undefined) effect.clampMax = clampMax;
  return effect;
}

function readEvidence(value: unknown, path: string, errors: string[]): EvidenceTag[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be a list of evidence tags.`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${path} must contain at least one tag: say how you know this.`);
    return undefined;
  }
  if (value.length > PACK_LIMITS.maxEvidence) {
    errors.push(`${path} has more than ${PACK_LIMITS.maxEvidence} tags.`);
    return undefined;
  }
  const out: EvidenceTag[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const p = `${path}[${i}]`;
    const raw = value[i];
    if (!isDict(raw)) {
      errors.push(`${p} must be an object.`);
      continue;
    }
    checkKeys(raw, ['cls', 'text', 'source'], p, errors);
    const cls = EVIDENCE_CLASSES.find((c) => c === raw['cls']);
    if (!cls) errors.push(`${p}.cls must be one of ${EVIDENCE_CLASSES.join(', ')}.`);
    const text = readString(raw['text'], `${p}.text`, errors, 1, PACK_LIMITS.maxEvidenceText);
    const source =
      raw['source'] === undefined
        ? undefined
        : readString(raw['source'], `${p}.source`, errors, 1, 300);
    if (cls && text) out.push(source ? { cls, text, source } : { cls, text });
  }
  return out;
}

function readRule(
  value: unknown,
  path: string,
  errors: string[],
  packId: string,
  vars: Set<string>,
  archetypeIds: Set<string>,
  ruleIds: Set<string>
): Rule | undefined {
  if (!isDict(value)) {
    errors.push(`${path} must be an object.`);
    return undefined;
  }
  checkKeys(
    value,
    [
      'id',
      'label',
      'summary',
      'detail',
      'type',
      'when',
      'weight',
      'monthsMin',
      'monthsMax',
      'durationMonths',
      'cooldown',
      'once',
      'effects',
      'assumptions',
      'uncertainties',
      'evidence',
      'tradeoffs',
      'nextSteps',
      'failurePoints',
      'resources',
      'decision',
      'imagination',
      'requires',
    ],
    path,
    errors
  );

  const id = readString(value['id'], `${path}.id`, errors, 1, 90);
  if (id) {
    if (!id.startsWith(`${packId}.`)) {
      errors.push(`${path}.id must start with "${packId}." so its origin is obvious.`);
    } else if (!RULE_SUFFIX.test(id.slice(packId.length + 1))) {
      errors.push(`${path}.id may only use a-z, 0-9, dot, dash and underscore after the pack id.`);
    }
    if (ruleIds.has(id)) errors.push(`${path}.id "${id}" already exists.`);
    ruleIds.add(id);
  }

  const label = readString(value['label'], `${path}.label`, errors, 1, PACK_LIMITS.maxLabel);
  const summary = readString(
    value['summary'],
    `${path}.summary`,
    errors,
    1,
    PACK_LIMITS.maxSummary
  );
  const detail =
    value['detail'] === undefined
      ? undefined
      : readString(value['detail'], `${path}.detail`, errors, 1, PACK_LIMITS.maxDetail);

  const type = NODE_TYPES.find((t) => t === value['type']);
  if (!type) errors.push(`${path}.type must be one of ${NODE_TYPES.join(', ')}.`);

  const weight = readNumber(value['weight'], `${path}.weight`, errors, 0.01, 100);
  const monthsMin = readNumber(
    value['monthsMin'],
    `${path}.monthsMin`,
    errors,
    0,
    PACK_LIMITS.maxMonths,
    true
  );
  const monthsMax = readNumber(
    value['monthsMax'],
    `${path}.monthsMax`,
    errors,
    0,
    PACK_LIMITS.maxMonths,
    true
  );
  if (monthsMin !== undefined && monthsMax !== undefined && monthsMin > monthsMax) {
    errors.push(`${path}.monthsMin must not be after monthsMax.`);
  }
  const durationMonths = readNumber(
    value['durationMonths'],
    `${path}.durationMonths`,
    errors,
    0,
    36,
    true
  );
  const cooldown =
    value['cooldown'] === undefined
      ? undefined
      : readNumber(value['cooldown'], `${path}.cooldown`, errors, 0, PACK_LIMITS.maxMonths, true);
  const once =
    value['once'] === undefined ? undefined : readBool(value['once'], `${path}.once`, errors);
  const imagination =
    value['imagination'] === undefined
      ? undefined
      : readNumber(value['imagination'], `${path}.imagination`, errors, 0, 1);

  // A custom pack must say which kind of situation it belongs to. Without this
  // a rule written for a career change would fire on a house move.
  const rawRequires = value['requires'];
  let requires: string[] | undefined;
  if (!Array.isArray(rawRequires) || rawRequires.length === 0) {
    errors.push(`${path}.requires must name at least one archetype, e.g. ["career"].`);
  } else {
    requires = [];
    const seen = new Set<string>();
    for (let i = 0; i < rawRequires.length; i += 1) {
      const r = readString(rawRequires[i], `${path}.requires[${i}]`, errors, 1, 60);
      if (!r) continue;
      if (!archetypeIds.has(r)) {
        errors.push(`${path}.requires[${i}] "${r}" is not a known archetype.`);
      } else if (seen.has(r)) {
        errors.push(`${path}.requires[${i}] "${r}" is listed twice.`);
      } else {
        seen.add(r);
        requires.push(r);
      }
    }
  }

  const when =
    value['when'] === undefined ? {} : readWhen(value['when'], `${path}.when`, errors, vars);

  const rawEffects = value['effects'];
  let effects: Effect[] | undefined;
  if (!Array.isArray(rawEffects) || rawEffects.length === 0) {
    errors.push(`${path}.effects must contain at least one change.`);
  } else if (rawEffects.length > PACK_LIMITS.maxEffects) {
    errors.push(`${path}.effects has more than ${PACK_LIMITS.maxEffects} changes.`);
  } else {
    effects = [];
    for (let i = 0; i < rawEffects.length; i += 1) {
      const e = readEffect(rawEffects[i], `${path}.effects[${i}]`, errors, vars);
      if (e) effects.push(e);
    }
    if (effects.length !== rawEffects.length) effects = undefined;
  }

  const evidence = readEvidence(value['evidence'], `${path}.evidence`, errors);

  const assumptions =
    value['assumptions'] === undefined
      ? undefined
      : readStringList(
          value['assumptions'],
          `${path}.assumptions`,
          errors,
          PACK_LIMITS.maxListItems,
          PACK_LIMITS.maxListItem
        );
  const uncertainties =
    value['uncertainties'] === undefined
      ? undefined
      : readStringList(
          value['uncertainties'],
          `${path}.uncertainties`,
          errors,
          PACK_LIMITS.maxListItems,
          PACK_LIMITS.maxListItem
        );
  const nextSteps =
    value['nextSteps'] === undefined
      ? undefined
      : readStringList(
          value['nextSteps'],
          `${path}.nextSteps`,
          errors,
          PACK_LIMITS.maxListItems,
          PACK_LIMITS.maxListItem
        );
  const failurePoints =
    value['failurePoints'] === undefined
      ? undefined
      : readStringList(
          value['failurePoints'],
          `${path}.failurePoints`,
          errors,
          PACK_LIMITS.maxListItems,
          PACK_LIMITS.maxListItem
        );
  const resources =
    value['resources'] === undefined
      ? undefined
      : readStringList(
          value['resources'],
          `${path}.resources`,
          errors,
          PACK_LIMITS.maxListItems,
          PACK_LIMITS.maxListItem
        );

  let tradeoffs: Rule['tradeoffs'];
  if (value['tradeoffs'] !== undefined) {
    const raw = value['tradeoffs'];
    if (!isDict(raw)) {
      errors.push(`${path}.tradeoffs must be an object.`);
    } else {
      checkKeys(raw, ['gains', 'costs'], `${path}.tradeoffs`, errors);
      const gains = readStringList(raw['gains'], `${path}.tradeoffs.gains`, errors, 8, 400);
      const costs = readStringList(raw['costs'], `${path}.tradeoffs.costs`, errors, 8, 400);
      if (gains && costs) tradeoffs = { gains, costs };
    }
  }

  // A rule-defined decision is part of the built-in shape but no engine path
  // expands it yet. Accepting it would author a question that never appears, so
  // say so instead.
  if (value['decision'] !== undefined) {
    errors.push(
      `${path}.decision is not supported yet: a pack cannot define a decision the engine will ask.`
    );
  }

  if (
    !id ||
    !label ||
    !summary ||
    !type ||
    weight === undefined ||
    monthsMin === undefined ||
    monthsMax === undefined ||
    durationMonths === undefined ||
    !requires ||
    !when ||
    !effects ||
    !evidence
  ) {
    return undefined;
  }

  const rule: Rule = {
    id,
    label,
    summary,
    type,
    when,
    weight,
    monthsMin,
    monthsMax,
    durationMonths,
    effects,
    evidence,
    requires,
  };
  if (detail !== undefined) rule.detail = detail;
  if (cooldown !== undefined) rule.cooldown = cooldown;
  if (once !== undefined) rule.once = once;
  if (imagination !== undefined) rule.imagination = imagination;
  if (assumptions !== undefined) rule.assumptions = assumptions;
  if (uncertainties !== undefined) rule.uncertainties = uncertainties;
  if (nextSteps !== undefined) rule.nextSteps = nextSteps;
  if (failurePoints !== undefined) rule.failurePoints = failurePoints;
  if (resources !== undefined) rule.resources = resources;
  if (tradeoffs !== undefined) rule.tradeoffs = tradeoffs;
  return rule;
}

/**
 * Validates a pack object (the `pack` member of the envelope).
 *
 * Kept separate from the envelope so packs restored from local storage are
 * validated by exactly the same rules as an imported file.
 */
export function parsePackValue(value: unknown, options: PackParseOptions = {}): PackParseResult {
  const errors: string[] = [];
  if (!isDict(value)) return { ok: false, errors: ['The pack must be a JSON object.'] };

  checkKeys(
    value,
    ['id', 'name', 'description', 'vars', 'rules', 'startingModifiers'],
    'pack',
    errors
  );

  const id = readString(value['id'], 'pack.id', errors, 1, 80);
  if (id && !PACK_ID.test(id)) {
    errors.push('pack.id must start with "custom." and use a-z, 0-9, dot, dash and underscore.');
  }
  const name = readString(value['name'], 'pack.name', errors, 1, PACK_LIMITS.maxName);
  const description = readString(
    value['description'],
    'pack.description',
    errors,
    1,
    PACK_LIMITS.maxDescription
  );

  const vars = value['vars'];
  if (vars !== undefined && (!Array.isArray(vars) || vars.length > 0)) {
    errors.push(
      'pack.vars is not supported yet: a custom pack may only use variables the app already models.'
    );
  }
  const startingModifiers = value['startingModifiers'];
  if (
    startingModifiers !== undefined &&
    (!Array.isArray(startingModifiers) || startingModifiers.length > 0)
  ) {
    errors.push('pack.startingModifiers is not supported yet.');
  }

  const builtInPackIds = new Set(ALL_PACKS.map((p) => p.id));
  if (id && builtInPackIds.has(id)) errors.push(`pack.id "${id}" is used by a built-in pack.`);
  if (id && options.existingPackIds?.includes(id)) {
    errors.push(`pack.id "${id}" is already installed.`);
  }

  const varsSet = new Set(ALL_VARS.map((v) => v.key));
  const archetypeIds = new Set(ARCHETYPES.map((a) => a.id));
  const ruleIds = new Set([...allRuleIds(), ...(options.existingRuleIds ?? [])]);

  const rawRules = value['rules'];
  let rules: Rule[] | undefined;
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    errors.push('pack.rules must contain at least one rule.');
  } else if (rawRules.length > PACK_LIMITS.maxRulesPerPack) {
    errors.push(`pack.rules has more than ${PACK_LIMITS.maxRulesPerPack} rules.`);
  } else if (id) {
    rules = [];
    for (let i = 0; i < rawRules.length; i += 1) {
      const rule = readRule(
        rawRules[i],
        `pack.rules[${i}]`,
        errors,
        id,
        varsSet,
        archetypeIds,
        ruleIds
      );
      if (rule) rules.push(rule);
    }
    if (
      rules.length > 0 &&
      (options.existingRuleIds?.length ?? 0) + rules.length > PACK_LIMITS.maxTotalRules
    ) {
      errors.push(
        `Installing this pack would exceed the ${PACK_LIMITS.maxTotalRules}-rule limit for custom packs.`
      );
    }
  }

  if (errors.length > 0 || !id || !name || !description || !rules) {
    return { ok: false, errors: errors.length > 0 ? errors : ['The pack is incomplete.'] };
  }

  return { ok: true, pack: { id, name, description, vars: [], rules } };
}

/**
 * Parses a pack file: a small envelope so a reader can tell what the file is.
 */
export function parsePackFile(text: string, options: PackParseOptions = {}): PackParseResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > PACK_LIMITS.maxFileBytes) {
    return {
      ok: false,
      errors: [`The file is larger than ${Math.round(PACK_LIMITS.maxFileBytes / 1024)} KB.`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `That file is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}.`,
      ],
    };
  }

  if (!isDict(parsed)) return { ok: false, errors: ['The file must contain a JSON object.'] };
  const envelopeErrors: string[] = [];
  checkKeys(parsed, ['format', 'formatVersion', 'pack'], 'file', envelopeErrors);
  if (envelopeErrors.length > 0) return { ok: false, errors: envelopeErrors };

  if (parsed['format'] !== PACK_FORMAT) {
    return { ok: false, errors: [`file.format must be "${PACK_FORMAT}".`] };
  }
  if (parsed['formatVersion'] !== PACK_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [`file.formatVersion must be ${PACK_FORMAT_VERSION}.`],
    };
  }
  return parsePackValue(parsed['pack'], options);
}

/** The rule and pack ids a pack adds, for collision checks and diagnostics. */
export function packIds(pack: RulePack): { packId: string; ruleIds: string[] } {
  return { packId: pack.id, ruleIds: pack.rules.map((r) => r.id) };
}
