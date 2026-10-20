/**
 * The offline provider — the default and always-available generator.
 *
 * This is not a stub. It composes a branching narrative from the rule catalogue: it detects the
 * scenario archetypes, selects the branch options those archetypes imply, runs the deterministic
 * engine forward, and then renders the resulting nodes as a scenario response. The effect is
 * that "Generate with AI" and "Generate with the built-in engine" produce universes of the same
 * quality and shape, differing only in prose and in the choice of which plausible events occur.
 *
 * Because it is the fallback for every failed provider call, it must never fail.
 */
import { ALL_PACKS } from '../core/packs';
import {
  activeRules,
  buildTextContext,
  createUniverse,
  derive,
  goalContributions,
  pickRule,
  resolveText,
  ruleWeight,
  LIMITS,
} from '../core/engine';
import { applyEffects } from '../core/rulePack';
import { detectArchetypes, selectOptions } from '../core/archetypes';
import { Rng, hashSeed, randomSeed } from '../core/rng';
import { formatValue, getState } from '../core/vars';
import { ALL_VARS } from '../core/packs/vars';
import type { ScenarioPrompt, StateVector, VarDef } from '../core/types';
import type {
  AiEdge,
  AiNode,
  AiScenarioResponse,
} from './schema';
import type { GenerationRequest, GenerationResult, ScenarioProvider } from './provider';

const USAGE_LIMIT = LIMITS.initialStepsPerBranch;

interface ComposerOptions {
  /** Overrides for reproducibility; normally derived from the prompt. */
  seed?: number;
}

/**
 * Composes a response for a scenario. Deterministic for a given prompt + seed, so a universe
 * generated offline can be reproduced exactly.
 */
export function composeScenario(
  prompt: ScenarioPrompt,
  vars: readonly VarDef[] = ALL_VARS,
  options: ComposerOptions = {},
): AiScenarioResponse {
  const seed = options.seed ?? (hashSeed(`${prompt.situation}|${prompt.decision}|${prompt.horizon}`) || randomSeed());
  const rng = new Rng(seed);
  const ctx = buildTextContext(prompt);
  const archetypes = prompt.archetypes.length > 0
    ? prompt.archetypes
    : detectArchetypes(`${prompt.situation} ${prompt.decision} ${prompt.goals.join(' ')}`);

  const optionList = selectOptions(archetypes, Math.max(2, Math.min(prompt.branchCount, 6)));

  const nodes: AiNode[] = [];
  const edges: AiEdge[] = [];
  const branches: NonNullable<AiScenarioResponse['branches']> = [];
  const globalAssumptions: string[] = [];
  const unknowns: string[] = [];

  // --- Starting node ------------------------------------------------------
  nodes.push({
    ref: 'start',
    type: 'event',
    title: prompt.title || 'The decision in front of you',
    summary: prompt.situation || 'Your starting situation as described.',
    detail: prompt.decision
      ? `The decision under consideration: ${prompt.decision}`
      : 'No specific decision was stated, so the model explores the situation as a whole.',
    t: 0,
    assumptions: [],
    uncertainties: [
      'Everything below is conditional on this situation being described accurately.',
    ],
    evidence: [
      { cls: 'user-fact', text: 'Taken directly from what you described.' },
    ],
  });

  const baseState = derive(seedState(prompt, vars), archetypes);

  for (let i = 0; i < optionList.length; i += 1) {
    const option = optionList[i];
    if (!option) continue;

    const applied = applyEffects(baseState, option.effects, vars, rng);
    const state = derive(applied.state, archetypes);

    const branchRef = `branch${i}`;
    const decisionRef = `${branchRef}.decision`;

    branches.push({
      ref: branchRef,
      name: option.name,
      intent: option.intent,
      description: `${option.intent} Modelled from the "${option.label}" option implied by this situation.`,
    });

    nodes.push({
      ref: decisionRef,
      type: 'decision',
      title: option.label,
      summary: `${option.intent} This is one of ${optionList.length} mutually exclusive commitments the model sees in your situation. The others are preserved as separate branches rather than discarded.`,
      detail: option.intent,
      t: 0,
      assumptions: [`You commit to "${option.label}" rather than one of the alternative branches.`],
      uncertainties: [
        'The initial effects are modelled, not measured. They reflect the typical shape of this route, not your specific circumstances.',
      ],
      evidence: [
        { cls: 'user-fact', text: `This branch assumes you commit to: ${option.label}.` },
        {
          cls: 'assumption',
          text: `Initial state changes are taken from a rules catalogue for "${option.name}".`,
        },
      ],
      tradeoffs: {
        gains: describeBiggestGains(state, baseState, vars),
        costs: describeBiggestCosts(state, baseState, vars),
      },
      decision: {
        question: prompt.decision || 'Which commitment do you make?',
        options: optionList
          .filter((o) => o.id !== option.id)
          .map((o) => ({ id: o.id, label: `Instead: ${o.label}` })),
      },
      effects: option.effects.map((e) => ({
        key: e.key,
        op: (e.op === 'set' || e.op === 'mul' ? e.op : 'add') as 'add' | 'set' | 'mul',
        value: e.value ?? (e.from ? 0 : 0),
        reason: e.reason,
      })),
    });

    edges.push({
      from: 'start',
      to: decisionRef,
      kind: 'choice',
      label: option.label,
      confidence: 'high',
      hypothesis: `Committing to "${option.label}" changes the starting state in ways the other branches do not.`,
    });

    // --- Events along this branch ----------------------------------------
    const rules = activeRules(ALL_PACKS, archetypes);
    const usage = { last: new Map<string, number>(), once: new Set<string>() };
    let t = 0;
    let parentRef = decisionRef;

    for (let step = 0; step < USAGE_LIMIT; step += 1) {
      if (t >= prompt.horizon) break;
      const rule = pickRule(rng, rules, state, t, prompt.imagination, option.riskBias, usage);
      if (!rule) break;

      const months = Math.max(1, Math.min(rule.durationMonths, prompt.horizon - t));
      const timeChange = (getState(state, 'income') - getState(state, 'expenses')) * months;
      const afterTime: StateVector = {
        ...state,
        money: getState(state, 'money') + timeChange,
      };
      const stepApplied = applyEffects(afterTime, rule.effects, vars, rng);
      const nextState = derive(stepApplied.state, archetypes);

      for (const key of Object.keys(nextState)) {
        state[key] = nextState[key] as number;
      }
      t += months;
      usage.last.set(rule.id, t);
      if (rule.once) usage.once.add(rule.id);

      const ref = `${branchRef}.s${step}`;
      const atHorizon = t >= prompt.horizon;

      nodes.push({
        ref,
        type: atHorizon ? 'ending' : rule.type,
        title: resolveText(rule.label, ctx),
        summary: resolveText(rule.summary, ctx),
        ...(rule.detail ? { detail: resolveText(rule.detail, ctx) } : {}),
        t: t,
        assumptions: rule.assumptions ?? [],
        uncertainties: rule.uncertainties ?? [],
        evidence: rule.evidence.map((e) => ({
          cls: e.cls,
          text: e.text,
          ...(e.source ? { source: e.source } : {}),
        })),
        ...(rule.tradeoffs ? { tradeoffs: rule.tradeoffs } : {}),
        ...(rule.nextSteps ? { nextSteps: rule.nextSteps } : {}),
        ...(rule.failurePoints ? { failurePoints: rule.failurePoints } : {}),
      });

      edges.push({
        from: parentRef,
        to: ref,
        kind: 'causal',
        confidence: (rule.imagination ?? 0) > 0.4 ? 'low' : 'medium',
        hypothesis: `On the "${option.name}" route, the state reached by month ${t - months} makes this a plausible next development.`,
      });

      parentRef = ref;
    }
  }

  // --- Assessor node ------------------------------------------------------
  const carry = goalContributions(archetypes)
    .map((c) => {
      const def = vars.find((v) => v.key === c.key);
      return def ? def.label.toLowerCase() : c.key;
    })
    .slice(0, 4);

  globalAssumptions.push(
    `Progress toward your goals is computed from ${carry.join(', ')}. Those are the concrete things this situation builds, not a judgement of the outcome.`,
  );
  globalAssumptions.push(
    `Monthly income and costs accrue continuously across the whole horizon; events change the rates rather than the totals directly.`,
  );
  globalAssumptions.push(
    'The rules catalogue encodes typical dynamics for these kinds of decisions. It does not encode anything specific about you.',
  );

  unknowns.push(
    'Timing and luck. Two people taking identical steps can end up in very different places for reasons no model can capture.',
  );
  unknowns.push(
    'Your actual tolerance for uncertainty, which usually only becomes clear after living with a choice.',
  );
  unknowns.push(
    'External conditions over the horizon: the labour market, the cost of living, the availability of the specific opportunities you would want.',
  );

  return {
    schema: 'whatif.scenario.v1',
    branchLabel: prompt.title || 'Generated universe',
    nodes,
    edges,
    branches,
    globalAssumptions,
    unknowns,
  };
}

/** Seeds a starting state from the prompt's own words, with honest defaults otherwise. */
function seedState(prompt: ScenarioPrompt, vars: readonly VarDef[]): StateVector {
  const state: StateVector = {};
  for (const v of vars) {
    state[v.key] = v.unit === 'currency' ? 0 : 0;
  }
  state['money'] = 6000;
  state['income'] = 2200;
  state['expenses'] = 1700;
  state['stress'] = 22;
  state['energy'] = 62;
  state['wellbeing'] = 58;
  state['focus'] = 46;
  state['optionality'] = 34;
  state['network'] = 26;
  state['information'] = 14;
  state['decisionConfidence'] = 12;
  state['relationships'] = 38;
  if (prompt.horizon > 0) state['runwayMonths'] = prompt.horizon;
  return state;
}

function describeBiggestGains(
  after: StateVector,
  before: StateVector,
  vars: readonly VarDef[],
): string[] {
  const moves: { text: string; magnitude: number }[] = [];
  for (const def of vars) {
    if (def.direction !== 'up') continue;
    const delta = getState(after, def.key) - getState(before, def.key);
    if (delta <= 0) continue;
    moves.push({
      text: `${def.label} moves to ${formatValue(getState(after, def.key), def.unit)} (${delta > 0 ? '+' : ''}${formatValue(delta, def.unit)})`,
      magnitude: normaliseDelta(delta, def),
    });
  }
  moves.sort((a, b) => b.magnitude - a.magnitude);
  return moves.slice(0, 3).map((m) => m.text);
}

function describeBiggestCosts(
  after: StateVector,
  before: StateVector,
  vars: readonly VarDef[],
): string[] {
  const moves: { text: string; magnitude: number }[] = [];
  for (const def of vars) {
    const delta = getState(after, def.key) - getState(before, def.key);
    const worse = def.direction === 'down' ? delta > 0 : delta < 0;
    if (!worse) continue;
    moves.push({
      text: `${def.label} moves to ${formatValue(getState(after, def.key), def.unit)} (${delta > 0 ? '+' : ''}${formatValue(delta, def.unit)})`,
      magnitude: normaliseDelta(delta, def),
    });
  }
  moves.sort((a, b) => b.magnitude - a.magnitude);
  return moves.slice(0, 3).map((m) => m.text);
}

function normaliseDelta(delta: number, def: VarDef): number {
  const scale = def.unit === 'currency' ? 1000 : def.unit === 'months' ? 6 : 20;
  return Math.abs(delta) / scale;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/** Reports how many rules are available, for the "what will be generated" preview. */
export function catalogueStats(prompt: ScenarioPrompt): {
  archetypes: string[];
  ruleCount: number;
  optionCount: number;
} {
  const archetypes = prompt.archetypes.length > 0
    ? prompt.archetypes
    : detectArchetypes(`${prompt.situation} ${prompt.decision} ${prompt.goals.join(' ')}`);
  const rules = activeRules(ALL_PACKS, archetypes);
  const options = selectOptions(archetypes, Math.max(2, Math.min(prompt.branchCount, 6)));
  return { archetypes, ruleCount: rules.length, optionCount: options.length };
}

export const offlineProvider: ScenarioProvider = {
  id: 'offline',
  label: 'Built-in engine',
  available: true,

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const started = Date.now();
    request.onProgress?.('Detecting the shape of the situation');
    const archetypes = request.prompt.archetypes.length > 0
      ? request.prompt.archetypes
      : detectArchetypes(`${request.prompt.situation} ${request.prompt.decision} ${request.prompt.goals.join(' ')}`);
    const prompt: ScenarioPrompt = { ...request.prompt, archetypes };

    request.onProgress?.(`Selected ${archetypes.length} relevant rule packs`);
    const data = composeScenario(prompt, request.vars);
    request.onProgress?.('Simulating the branches forward');

    if (request.kind === 'expand-node' && request.nodeTitle) {
      // Already-simulated expansion is handled by the engine; the offline composer simply
      // offers the next plausible steps for the node under inspection.
      const extra = expansionFor(prompt, request.nodeTitle, request.state ?? {});
      return {
        ok: true,
        provider: 'offline',
        providerLabel: this.label,
        data: { ...data, nodes: [...extra.nodes], edges: [...extra.edges], branchLabel: `Following: ${request.nodeTitle}` },
        notes: ['Composed locally by the rules engine.'],
        elapsedMs: Date.now() - started,
      };
    }

    return {
      ok: true,
      provider: 'offline',
      providerLabel: this.label,
      data,
      notes: [
        `Composed locally from ${archetypes.length} rule packs. Nothing was sent anywhere.`,
      ],
      elapsedMs: Date.now() - started,
    };
  },
};

/** Produces a short continuation set for expanding an existing node. */
function expansionFor(
  prompt: ScenarioPrompt,
  nodeTitle: string,
  state: StateVector,
): { nodes: AiNode[]; edges: AiEdge[] } {
  const rng = new Rng(hashSeed(`${prompt.decision}|${nodeTitle}`));
  const rules = activeRules(ALL_PACKS, prompt.archetypes);
  const usage = { last: new Map<string, number>(), once: new Set<string>() };
  const nodes: AiNode[] = [];
  const edges: AiEdge[] = [];
  const ctx = buildTextContext(prompt);

  let current = derive(state, prompt.archetypes);
  let t = 0;
  let parentRef = 'root';

  nodes.push({
    ref: 'root',
    type: 'event',
    title: nodeTitle,
    summary: `Continuing from: ${nodeTitle}`,
    t: 0,
    assumptions: [],
    uncertainties: [],
    evidence: [{ cls: 'user-fact', text: 'This is the point the expansion starts from.' }],
  });

  for (let step = 0; step < LIMITS.expansionSteps; step += 1) {
    const rule = pickRule(rng, rules, current, t, prompt.imagination, 0, usage);
    if (!rule) break;
    const months = Math.max(1, rule.durationMonths);
    const applied = applyEffects(current, rule.effects, ALL_VARS, rng);
    current = derive(applied.state, prompt.archetypes);
    t += months;
    usage.last.set(rule.id, t);
    if (rule.once) usage.once.add(rule.id);

    const ref = `e${step}`;
    nodes.push({
      ref,
      type: rule.type,
      title: resolveText(rule.label, ctx),
      summary: resolveText(rule.summary, ctx),
      t,
      assumptions: rule.assumptions ?? [],
      uncertainties: rule.uncertainties ?? [],
      evidence: rule.evidence.map((e) => ({
        cls: e.cls,
        text: e.text,
        ...(e.source ? { source: e.source } : {}),
      })),
      ...(rule.tradeoffs ? { tradeoffs: rule.tradeoffs } : {}),
    });
    edges.push({
      from: parentRef,
      to: ref,
      kind: 'causal',
      confidence: 'medium',
      hypothesis: `Continuing from "${nodeTitle}", this is a plausible subsequent development.`,
    });
    parentRef = ref;
  }

  return { nodes, edges };
}

/** Deterministic ordering helper so the composer's output is stable across runs. */
export function scoreRules(prompt: ScenarioPrompt): { id: string; weight: number }[] {
  const rules = activeRules(ALL_PACKS, prompt.archetypes);
  return rules
    .map((r) => ({ id: r.id, weight: ruleWeight(r, prompt.imagination, 0) }))
    .sort((a, b) => b.weight - a.weight);
}

export { createUniverse };
