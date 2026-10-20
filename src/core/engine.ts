/**
 * The simulation engine.
 *
 * A pure, deterministic function of (rule packs, prompt, seed, choices). It never touches the
 * DOM, the network or the filesystem, which is what makes it unit-testable and what makes a
 * universe exactly reproducible from its recorded seed.
 *
 * The shape of the model:
 *
 *   initial state  ->  [time passes: income & costs accrue]
 *                   ->  [an eligible rule fires and changes state]
 *                   ->  [derived quantities recomputed]
 *                   ->  repeat, bounded, until the horizon or the depth budget is reached
 *
 * Branches are produced by layering options on top of that loop: each option seeds a
 * different starting delta, and expansion can fork a path into new sub-branches.
 */
import { Rng } from './rng';
import { applyEffects, matchesConditions, type Rule, type RulePack } from './rulePack';
import { detectArchetypes, selectOptions, optionById, type BranchOption } from './archetypes';
import { ALL_VARS, VAR_BY_KEY } from './packs/vars';
import { clamp, clampForUnit } from './vars';
import { runLayout } from './layout';
import { SCHEMA_VERSION } from './types';
import type {
  Assumption,
  Branch,
  BranchId,
  EdgeId,
  EvidenceTag,
  LayoutPoint,
  NodeId,
  ScenarioPrompt,
  SimEdge,
  SimId,
  SimNode,
  SimulationDoc,
  StateDelta,
  StateVector,
  VarDef,
} from './types';

// ---------------------------------------------------------------------------
// Hard limits — a generated universe must stay bounded and the UI responsive.
// ---------------------------------------------------------------------------

export const LIMITS = {
  maxNodes: 420,
  maxBranches: 22,
  initialStepsPerBranch: 5,
  expansionSteps: 4,
  maxDepth: 9,
  /** Steps spent probing when estimating an assumption's sensitivity. */
  sensitivitySteps: 4,
} as const;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface EngineConfig {
  packs: readonly RulePack[];
  vars?: readonly VarDef[];
  seed: number;
  prompt: ScenarioPrompt;
}

// ---------------------------------------------------------------------------
// Text resolution
// ---------------------------------------------------------------------------

export interface TextContext {
  situation: string;
  decision: string;
  goal: string;
  situationShort: string;
}

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function buildTextContext(prompt: ScenarioPrompt): TextContext {
  return {
    situation: clip(prompt.situation || 'your situation', 220),
    decision: clip(prompt.decision || 'the decision in front of you', 160),
    goal: clip(prompt.goals[0] ?? 'what you are aiming for', 120),
    situationShort: clip(prompt.situation || 'the current situation', 72),
  };
}

const PLACEHOLDER = /\{(situation|decision|goal|situationShort)\}/g;

export function resolveText(template: string, ctx: TextContext): string {
  return template.replace(PLACEHOLDER, (_m, key: keyof TextContext) => ctx[key] ?? '');
}

// ---------------------------------------------------------------------------
// Rule selection
// ---------------------------------------------------------------------------

interface Usage {
  /** Months at which a rule last fired. */
  last: Map<string, number>;
  /** Rules that have already fired on this path. */
  once: Set<string>;
}

const USAGE_EMPTY = (): Usage => ({ last: new Map(), once: new Set() });

const FAVOURABLE = new Set(['opportunity', 'milestone']);

/**
 * Weights a rule by how well its imagination level matches the user's chosen register, and
 * by the risk profile of the branch. This is what makes "grounded analysis" and "creative
 * exploration" produce genuinely different universes instead of different labels.
 */
export function ruleWeight(rule: Rule, imagination: number, riskBias: number): number {
  const imag = rule.imagination ?? 0;
  const fit = Math.max(0.08, 1 - Math.abs(imag - imagination) * 1.5);
  let bias = 1;
  if (FAVOURABLE.has(rule.type)) bias = 1 + riskBias;
  else if (rule.type === 'setback') bias = 1 - riskBias;
  return rule.weight * fit * Math.max(0.05, bias);
}

/** All rules from `packs` that are available to the active archetypes. */
export function activeRules(packs: readonly RulePack[], archetypes: readonly string[]): Rule[] {
  const active = new Set(archetypes);
  const out: Rule[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (seen.has(rule.id)) continue;
      if (rule.requires && rule.requires.some((r) => !active.has(r))) continue;
      seen.add(rule.id);
      out.push(rule);
    }
  }
  return out;
}

/** Chooses the next rule to fire, or null when nothing is eligible. */
export function pickRule(
  rng: Rng,
  candidates: readonly Rule[],
  state: StateVector,
  t: number,
  imagination: number,
  riskBias: number,
  usage: Usage
): Rule | null {
  const scored: Rule[] = [];
  const weights: number[] = [];

  for (const rule of candidates) {
    if (rule.monthsMin > t || rule.monthsMax < t) continue;
    if (!matchesConditions(state, rule.when)) continue;
    if (rule.once && usage.once.has(rule.id)) continue;
    if (rule.cooldown) {
      const last = usage.last.get(rule.id);
      if (last !== undefined && t - last < rule.cooldown) continue;
    }
    const w = ruleWeight(rule, imagination, riskBias);
    if (w <= 0) continue;
    scored.push(rule);
    weights.push(w);
  }

  if (scored.length === 0) return null;
  const idx = rng.weightedIndex(weights);
  const chosen = idx >= 0 ? scored[idx] : undefined;
  return chosen ?? null;
}

// ---------------------------------------------------------------------------
// Derived quantities
// ---------------------------------------------------------------------------

/**
 * Goal progress is a transparent composite, not a verdict. Each archetype contributes a
 * weight to the concrete assets that path actually builds, and progress is the weighted mean
 * of those. Which variables feed it is exposed to the user in the UI.
 */
const GOAL_WEIGHTS: Record<string, { key: string; w: number }[]> = {
  education: [
    { key: 'credential', w: 0.4 },
    { key: 'skill:structured-theory', w: 0.25 },
    { key: 'portfolio', w: 0.2 },
    { key: 'skill:craft', w: 0.15 },
  ],
  learning: [
    { key: 'skill:craft', w: 0.4 },
    { key: 'portfolio', w: 0.35 },
    { key: 'reputation', w: 0.15 },
    { key: 'information', w: 0.1 },
  ],
  career: [
    { key: 'skill:professional-practice', w: 0.3 },
    { key: 'reputation', w: 0.25 },
    { key: 'portfolio', w: 0.2 },
    { key: 'stability', w: 0.25 },
  ],
  business: [
    { key: 'projectHealth', w: 0.3 },
    { key: 'marketFit', w: 0.3 },
    { key: 'income', w: 0.2 },
    { key: 'skill:business-building', w: 0.2 },
  ],
  relocation: [
    { key: 'belonging', w: 0.25 },
    { key: 'visaSecurity', w: 0.2 },
    { key: 'skill:independence', w: 0.35 },
    { key: 'network', w: 0.2 },
  ],
  creative: [
    { key: 'portfolio', w: 0.35 },
    { key: 'audience', w: 0.3 },
    { key: 'skill:craft', w: 0.35 },
  ],
  finance: [
    { key: 'runway', w: 0.45 },
    { key: 'money', w: 0.35 },
    { key: 'optionality', w: 0.2 },
  ],
  health: [
    { key: 'wellbeing', w: 0.4 },
    { key: 'healthBuffer', w: 0.35 },
    { key: 'energy', w: 0.25 },
  ],
  relationships: [
    { key: 'relationships', w: 0.5 },
    { key: 'network', w: 0.25 },
    { key: 'belonging', w: 0.25 },
  ],
  time: [
    { key: 'focus', w: 0.45 },
    { key: 'energy', w: 0.3 },
    { key: 'skill:craft', w: 0.25 },
  ],
  uncertainty: [
    { key: 'information', w: 0.45 },
    { key: 'decisionConfidence', w: 0.35 },
    { key: 'optionality', w: 0.2 },
  ],
};

const GOAL_FALLBACK = [
  { key: 'skill:craft', w: 0.3 },
  { key: 'portfolio', w: 0.25 },
  { key: 'optionality', w: 0.2 },
  { key: 'information', w: 0.25 },
];

/** The variables that currently feed "progress to goals", and how much each counts. */
export function goalContributions(archetypes: readonly string[]): { key: string; w: number }[] {
  const byKey = new Map<string, number>();
  const lists = archetypes
    .map((a) => GOAL_WEIGHTS[a])
    .filter((l): l is { key: string; w: number }[] => Array.isArray(l));
  const source = lists.length > 0 ? lists.flat() : GOAL_FALLBACK;
  for (const entry of source) {
    byKey.set(entry.key, (byKey.get(entry.key) ?? 0) + entry.w);
  }
  return [...byKey.entries()].map(([key, w]) => ({ key, w }));
}

/**
 * Recomputes derived keys after a transition.
 *
 * `runway` is derived, never assumed: it is liquid funds divided by net monthly burn, capped
 * at the planning horizon. `goalProgress` is the documented weighted composite above.
 */
export function derive(state: StateVector, archetypes: readonly string[]): StateVector {
  const next: StateVector = {};
  for (const [key, value] of Object.entries(state)) {
    if (!Number.isFinite(value)) continue; // a NaN must never propagate through the model
    const def = VAR_BY_KEY.get(key);
    next[key] = def ? clampForUnit(key, def.unit, value) : value;
  }
  const burn = Math.max(0, (next['expenses'] ?? 0) - (next['income'] ?? 0));
  const runway = burn <= 0.5 ? 120 : Math.max(0, next['money'] ?? 0) / burn;
  next['runway'] = clamp(Math.min(runway, 120), 0, 120);

  const contributions = goalContributions(archetypes);
  let weighted = 0;
  let totalW = 0;
  for (const { key, w } of contributions) {
    weighted += clamp(next[key] ?? 0, 0, 100) * w;
    totalW += w;
  }
  next['goalProgress'] = totalW > 0 ? clamp(weighted / totalW, 0, 100) : 0;
  return next;
}

// ---------------------------------------------------------------------------
// Time accrual
// ---------------------------------------------------------------------------

/** Deterministic, fully explainable passage of time: income minus costs, times months. */
function accrue(state: StateVector, months: number): { state: StateVector; delta: StateDelta[] } {
  const net = (state['income'] ?? 0) - (state['expenses'] ?? 0);
  const change = net * months;
  const before = state['money'] ?? 0;
  const after = clampForUnit('money', 'currency', before + change);
  const delta: StateDelta[] = [];
  if (Math.abs(change) > 0.5) {
    delta.push({
      key: 'money',
      before,
      after,
      reason: `${months} month${months === 1 ? '' : 's'} of ${net >= 0 ? 'net surplus' : 'net shortfall'}`,
    });
  }
  return { state: { ...state, money: after }, delta };
}

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

function counterFactory(prefix: string, taken: ReadonlySet<string> = new Set()): () => string {
  let n = 0;
  return () => {
    // Skip ids already present in the document: expansions run against an existing graph,
    // and reusing an id would silently replace a node the user is looking at.
    let id = `${prefix}${(n += 1).toString(36)}`;
    while (taken.has(id)) id = `${prefix}${(n += 1).toString(36)}`;
    return id;
  };
}

function evidenceFor(rule: Rule, branchNote?: string): EvidenceTag[] {
  const out: EvidenceTag[] = rule.evidence.slice();
  if (branchNote) out.unshift({ cls: 'user-fact', text: branchNote });
  return out;
}

/** Smallest `b<N>` not already used, so expansions never replace an existing branch. */
function nextBranchNumber(branches: Record<BranchId, Branch>): number {
  let n = Object.keys(branches).length;
  while (branches[`b${n}`] !== undefined) n += 1;
  return n;
}

function nodeHorizon(t: number, horizon: number): string {
  if (t <= 0) return 'Now';
  if (t >= horizon) return `${Math.round(horizon)} months — end of horizon`;
  return `${Math.max(1, Math.round(t))} months in`;
}

// ---------------------------------------------------------------------------
// Universe creation
// ---------------------------------------------------------------------------

interface RuleCatalogue {
  rules: Rule[];
  vars: VarDef[];
}

interface RunState {
  state: StateVector;
  t: number;
  usage: Usage;
}

/** The starting state for a scenario, before any branch effects. */
export function baseStateFor(prompt: ScenarioPrompt, vars?: readonly VarDef[]): StateVector {
  return derive(initialState(prompt, vars ?? ALL_VARS), prompt.archetypes);
}

function initialState(prompt: ScenarioPrompt, promptVars: readonly VarDef[]): StateVector {
  const state: StateVector = {};

  // Seed monetary values from anything the user actually told us, with honest defaults
  // otherwise. Defaults are exposed as editable assumptions so nothing is hidden.
  const funds = parseMoney(prompt.resources, ['save', 'savings', 'fund', 'buffer', 'money']);
  const income = parseMoney(prompt.resources, ['income', 'earn', 'salary', 'monthly']);
  const costs = parseMoney(prompt.resources, ['cost', 'spend', 'expenses', 'rent', 'bills']);

  state['money'] = funds ?? 6000;
  state['income'] = income ?? 2200;
  state['expenses'] = costs ?? 1700;

  state['stress'] = 22;
  state['energy'] = 62;
  state['wellbeing'] = 58;
  state['focus'] = 46;
  state['optionality'] = 34;
  state['network'] = 26;
  state['reputation'] = 12;
  state['information'] = 14;
  state['risk'] = 24;
  state['variance'] = 18;
  state['relationships'] = 38;
  state['decisionConfidence'] = 12;
  state['healthBuffer'] = 64;
  state['belonging'] = 44;
  state['visaSecurity'] = 72;
  state['sleep'] = 62;
  state['stability'] = 30;
  state['leverage'] = 20;
  state['marketFit'] = 6;
  state['audience'] = 3;
  state['projectHealth'] = 8;
  state['portfolio'] = 6;
  state['credential'] = 4;
  state['runwayMonths'] = 0;

  for (const v of promptVars) {
    if (state[v.key] === undefined) state[v.key] = 0;
  }
  return state;
}

/** Very small, conservative parser: looks for a currency-ish number near a keyword. */
function parseMoney(strings: readonly string[], keywords: readonly string[]): number | null {
  const amount = /(?:[$€£]\s*)?(\d[\d,.]*\s*(?:k|m|thousand|million)?)/i;
  for (const s of strings) {
    const low = s.toLowerCase();
    if (!keywords.some((k) => low.includes(k))) continue;
    const m = amount.exec(s);
    if (!m || m[1] === undefined) continue;
    const raw = m[1].toLowerCase().replace(/[,\s]/g, '');
    let value = parseFloat(raw.replace(/[km]$/, ''));
    if (!Number.isFinite(value)) continue;
    if (raw.endsWith('k')) value *= 1000;
    else if (raw.endsWith('m')) value *= 1_000_000;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function makeBranch(
  id: BranchId,
  name: string,
  hue: number,
  root: NodeId,
  description: string
): Branch {
  return { id, name, hue, root, description };
}

/**
 * Creates an edge AND keeps the two nodes' `children`/`parents` arrays in step with it.
 *
 * The arrays are derived data, but they are read on hot paths (layout, ancestry walks), so they
 * are maintained at the single point where an edge comes into existence rather than rebuilt
 * afterwards. Idempotent per pair, so a node re-linked twice never gains a duplicate entry.
 */
function link(
  edges: Record<EdgeId, SimEdge>,
  nodes: Record<NodeId, SimNode>,
  makeId: () => string,
  from: NodeId,
  to: NodeId,
  kind: SimEdge['kind'],
  label: string | undefined,
  hypothesis: string,
  confidence: SimEdge['confidence']
): void {
  const id = makeId();
  edges[id] = { id, from, to, kind, ...(label ? { label } : {}), hypothesis, confidence };
  const parentNode = nodes[from];
  if (parentNode && !parentNode.children.includes(to)) {
    nodes[from] = { ...parentNode, children: [...parentNode.children, to] };
  }
  const childNode = nodes[to];
  if (childNode && !childNode.parents.includes(from)) {
    nodes[to] = { ...childNode, parents: [...childNode.parents, from] };
  }
}

function buildNode(params: {
  id: NodeId;
  type: SimNode['type'];
  title: string;
  summary: string;
  detail?: string;
  t: number;
  horizon: number;
  branch: BranchId;
  depth: number;
  rule: Rule | null;
  state: StateVector;
  delta: StateDelta[];
  evidence: EvidenceTag[];
  question?: string;
  options?: { id: string; label: string }[];
  expandable: boolean;
  expanded: boolean;
}): SimNode {
  const { rule } = params;
  const node: SimNode = {
    id: params.id,
    type: params.type,
    title: params.title,
    summary: params.summary,
    t: params.t,
    horizon: nodeHorizon(params.t, params.horizon),
    branch: params.branch,
    depth: params.depth,
    parents: [],
    children: [],
    assumptions: rule?.assumptions ?? [],
    uncertainties: rule?.uncertainties ?? [],
    evidence: params.evidence,
    state: params.state,
    delta: params.delta,
    expandable: params.expandable,
    expanded: params.expanded,
  };
  if (params.detail) node.detail = params.detail;
  if (rule?.tradeoffs) node.tradeoffs = rule.tradeoffs;
  if (rule?.nextSteps) node.nextSteps = rule.nextSteps;
  if (rule?.failurePoints) node.failurePoints = rule.failurePoints;
  if (rule?.resources) node.resources = rule.resources;
  if (rule?.id) node.ruleId = rule.id;
  if (params.question && params.options) {
    node.decision = { question: params.question, options: params.options.map((o) => ({ ...o })) };
  }
  return node;
}

/**
 * Runs one branch forward from `runState`, producing a chain of nodes.
 * Pure: mutates only the output records.
 */
function simulateSegment(params: {
  catalogue: RuleCatalogue;
  prompt: ScenarioPrompt;
  ctx: TextContext;
  rng: Rng;
  runState: RunState;
  branchId: BranchId;
  depth: number;
  parentId: NodeId;
  maxSteps: number;
  nextNodeId: () => string;
  nextEdgeId: () => string;
  nodes: Record<NodeId, SimNode>;
  edges: Record<EdgeId, SimEdge>;
  riskBias: number;
}): NodeId[] {
  const {
    catalogue,
    prompt,
    ctx,
    rng,
    runState,
    branchId,
    depth,
    parentId,
    maxSteps,
    nextNodeId,
    nextEdgeId,
    nodes,
    edges,
    riskBias,
  } = params;

  const created: NodeId[] = [];
  let parentIdCur = parentId;

  for (let step = 0; step < maxSteps; step += 1) {
    if (Object.keys(nodes).length >= LIMITS.maxNodes) break;
    const remaining = prompt.horizon - runState.t;
    if (remaining <= 0) break;

    const rule = pickRule(
      rng,
      catalogue.rules,
      runState.state,
      runState.t,
      prompt.imagination,
      riskBias,
      runState.usage
    );
    if (!rule) break;

    const months = Math.max(1, Math.min(rule.durationMonths, remaining));
    const timePassed = accrue(runState.state, months);
    const applied = applyEffects(timePassed.state, rule.effects, catalogue.vars, rng);
    const state = derive(applied.state, prompt.archetypes);

    const delta: StateDelta[] = [
      ...timePassed.delta,
      ...applied.applied.map((a) => ({
        key: a.key,
        before: a.before,
        after: a.after,
        reason: a.reason,
      })),
    ].filter((d) => Math.abs(d.after - d.before) > 1e-9);

    runState.t += months;
    runState.usage.last.set(rule.id, runState.t);
    if (rule.once) runState.usage.once.add(rule.id);
    runState.state = state;

    const atHorizon = runState.t >= prompt.horizon;
    const id = nextNodeId();
    const node = buildNode({
      id,
      type: atHorizon ? 'ending' : rule.type,
      title: resolveText(rule.label, ctx),
      summary: resolveText(rule.summary, ctx),
      t: runState.t,
      horizon: prompt.horizon,
      branch: branchId,
      depth,
      rule,
      state,
      delta,
      evidence: evidenceFor(rule),
      expandable: !atHorizon && depth < LIMITS.maxDepth,
      expanded: false,
    });
    if (rule.detail) node.detail = resolveText(rule.detail, ctx);

    nodes[id] = node;
    link(
      edges,
      nodes,
      nextEdgeId,
      parentIdCur,
      id,
      rule.type === 'consequence' ? 'consequence' : 'causal',
      undefined,
      `The engine believes this follows from the state reached at ${nodeHorizon(runState.t - months, prompt.horizon)}.`,
      rule.imagination && rule.imagination > 0.4 ? 'low' : 'medium'
    );

    parentIdCur = id;
    created.push(id);
  }

  return created;
}

export interface CreateOptions {
  /** Override the number of initial branches (defaults to the prompt's). */
  branchCount?: number;
  /** Override the initial seed. */
  seed?: number;
  /** Overrides for assumption keys -> value, applied at construction time. */
  assumptionOverrides?: Record<string, number>;
  /**
   * Force the universe to contain only this branch option. Used by the "what if I had chosen
   * differently?" counterfactual, which rebuilds a universe around a single decision.
   */
  onlyOptionId?: string;
  id?: SimId;
  title?: string;
}

/** Builds the initial assumptions list for a scenario, seeded from the prompt. */
export function buildAssumptions(
  prompt: ScenarioPrompt,
  _seed: number,
  overrides: Record<string, number> = {}
): Assumption[] {
  const funds =
    parseMoney(prompt.resources, ['save', 'savings', 'fund', 'buffer', 'money']) ?? 6000;
  const income = parseMoney(prompt.resources, ['income', 'earn', 'salary', 'monthly']) ?? 2200;
  const costs =
    parseMoney(prompt.resources, ['cost', 'spend', 'expenses', 'rent', 'bills']) ?? 1700;

  const base: Omit<Assumption, 'value'>[] = [
    {
      id: 'a.funds',
      label: 'Starting funds',
      varKey: 'money',
      unit: 'currency',
      baseValue: funds,
      rationale:
        prompt.resources.length > 0
          ? 'Read from the resources you described; check it matches your actual position.'
          : 'Not stated, so a mid-range default is used. Change this to your real figure.',
      sensitivity: 0,
      editable: true,
    },
    {
      id: 'a.income',
      label: 'Monthly income',
      varKey: 'income',
      unit: 'currency',
      baseValue: income,
      rationale: 'Recurring money in each month at the start of the horizon.',
      sensitivity: 0,
      editable: true,
    },
    {
      id: 'a.costs',
      label: 'Monthly costs',
      varKey: 'expenses',
      unit: 'currency',
      baseValue: costs,
      rationale: 'Recurring money out each month at the start of the horizon.',
      sensitivity: 0,
      editable: true,
    },
    {
      id: 'a.horizon',
      label: 'Planning horizon',
      varKey: 'horizon',
      unit: 'months',
      baseValue: prompt.horizon,
      rationale: 'How far forward the universe is simulated.',
      sensitivity: 0,
      editable: true,
    },
  ];

  return base.map((a) => ({
    ...a,
    value: overrides[a.id] ?? a.baseValue,
  }));
}

/**
 * Builds the initial branching universe for a scenario.
 *
 * Deterministic for a given (prompt, seed) pair.
 */
export function createUniverse(config: EngineConfig, options: CreateOptions = {}): SimulationDoc {
  const prompt: ScenarioPrompt = {
    ...config.prompt,
    archetypes:
      config.prompt.archetypes.length > 0
        ? config.prompt.archetypes
        : detectArchetypes(
            `${config.prompt.situation} ${config.prompt.decision} ${config.prompt.goals.join(' ')}`
          ),
  };

  const vars: VarDef[] = [...(config.vars ?? ALL_VARS)];
  const seed = options.seed ?? config.seed;
  const rng = new Rng(seed);
  const ctx = buildTextContext(prompt);
  const catalogue: RuleCatalogue = { rules: activeRules(config.packs, prompt.archetypes), vars };

  const nextNodeId = counterFactory('n');
  const nextEdgeId = counterFactory('e');

  const nodes: Record<NodeId, SimNode> = {};
  const edges: Record<EdgeId, SimEdge> = {};
  const branches: Record<BranchId, Branch> = {};
  const layout: Record<NodeId, LayoutPoint> = {};

  const assumptions = buildAssumptions(prompt, seed, options.assumptionOverrides);
  const state = initialState(prompt, vars);
  for (const a of assumptions) {
    if (a.varKey === 'money' || a.varKey === 'income' || a.varKey === 'expenses') {
      state[a.varKey] = a.value;
    }
  }
  const derived0 = derive(state, prompt.archetypes);

  // --- The starting state -------------------------------------------------
  const startId = nextNodeId();
  const originBranchId = 'b0';
  branches[originBranchId] = makeBranch(
    originBranchId,
    'Where you are now',
    0,
    startId,
    'The state everything else branches from.'
  );

  nodes[startId] = buildNode({
    id: startId,
    type: 'start',
    title: prompt.title || 'The decision in front of you',
    summary: clip(prompt.situation || 'Your starting situation.', 320),
    detail: prompt.decision ? `The decision under consideration: ${prompt.decision}` : undefined,
    t: 0,
    horizon: prompt.horizon,
    branch: originBranchId,
    depth: 0,
    rule: null,
    state: derived0,
    delta: [],
    evidence: [
      {
        cls: 'user-fact',
        text: 'This is the situation as you described it. Everything downstream is conditional on it.',
      },
      ...(prompt.goals.length > 0
        ? [{ cls: 'user-fact' as const, text: `Stated goal: ${prompt.goals[0]}` }]
        : []),
    ],
    expandable: false,
    expanded: true,
  });

  // --- The branches -------------------------------------------------------
  const count = Math.max(2, Math.min(options.branchCount ?? prompt.branchCount, 6));
  const forcedOption = options.onlyOptionId ? optionById(options.onlyOptionId) : undefined;
  const optionsList = forcedOption ? [forcedOption] : selectOptions(prompt.archetypes, count);

  for (let i = 0; i < optionsList.length; i += 1) {
    const option = optionsList[i] as BranchOption;
    if (Object.keys(nodes).length >= LIMITS.maxNodes) break;
    if (Object.keys(branches).length >= LIMITS.maxBranches) break;

    const branchId = `b${i + 1}`;
    const decisionId = nextNodeId();

    const branchState = applyEffects(derived0, option.effects, vars, rng);
    const stateAfter = derive(branchState.state, prompt.archetypes);
    const delta = branchState.applied.map((a) => ({
      key: a.key,
      before: a.before,
      after: a.after,
      reason: a.reason,
    }));

    branches[branchId] = makeBranch(branchId, option.name, option.hue, decisionId, option.intent);

    nodes[decisionId] = buildNode({
      id: decisionId,
      type: 'decision',
      title: option.label,
      summary: resolveText(
        `${option.intent} Against the situation you described — ${ctx.situationShort} — this is the route where ${option.label.toLowerCase()} is the organising choice.`,
        ctx
      ),
      detail: option.intent,
      t: 0,
      horizon: prompt.horizon,
      branch: branchId,
      depth: 1,
      rule: null,
      state: stateAfter,
      delta,
      evidence: [
        { cls: 'user-fact', text: `This branch assumes you commit to: ${option.label}.` },
        {
          cls: 'assumption',
          text: `Initial effects are modelled from a rules catalogue for "${option.name}", not measured from your real life.`,
        },
      ],
      question: prompt.decision || 'What do you do next?',
      options: optionsList
        .filter((o) => o.id !== option.id)
        .slice(0, 3)
        .map((o) => ({ id: o.id, label: `Instead: ${o.label}` })),
      expandable: false,
      expanded: true,
    });

    link(
      edges,
      nodes,
      nextEdgeId,
      startId,
      decisionId,
      'choice',
      option.label,
      'Choosing this option commits to a different set of consequences than the others. The others are preserved as separate branches.',
      'high'
    );

    // Remember which option produced this decision node, so explanations can name it.
    rememberedOptions.set(decisionId, option.id);

    const runState: RunState = { state: stateAfter, t: 0, usage: USAGE_EMPTY() };
    simulateSegment({
      catalogue,
      prompt,
      ctx,
      rng,
      runState,
      branchId,
      depth: 2,
      parentId: decisionId,
      maxSteps: LIMITS.initialStepsPerBranch,
      nextNodeId,
      nextEdgeId,
      nodes,
      edges,
      riskBias: option.riskBias,
    });
  }

  const now = new Date().toISOString();
  const doc: SimulationDoc = {
    id: options.id ?? newId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    title: options.title ?? prompt.title ?? 'Untitled universe',
    prompt,
    seed,
    nodes,
    edges,
    branches,
    layout,
    vars: [...vars],
    assumptions,
    collapsed: [],
    meta: {
      generator: 'offline',
      providerLabel: 'Built-in rules engine',
      provenance:
        'Generated locally by the built-in simulation engine from a rules catalogue. No data left this machine.',
    },
  };

  return runLayout(doc);
}

/**
 * Which branch option produced a given decision node. Kept in a transient map rather than in
 * the document, because it is a generator concern, not user data.
 */
const rememberedOptions = new Map<NodeId, string>();

/** Option label used when a branch was created, for use in explanations. */
export function branchOptionId(nodeId: NodeId): string | undefined {
  return rememberedOptions.get(nodeId);
}

function newId(): SimId {
  return `sim_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

export interface ExpandResult {
  doc: SimulationDoc;
  added: NodeId[];
}

/**
 * Generates the next layer of a branch underneath `nodeId`.
 *
 * With a seeded coin-flip the expansion forks into two sub-branches (a new decision point),
 * otherwise it extends the path linearly. Because the seed is derived from the node id plus
 * the document seed, expanding the same node twice gives the same result.
 */
export function expandNode(
  doc: SimulationDoc,
  nodeId: NodeId,
  packs: readonly RulePack[]
): ExpandResult {
  const node = doc.nodes[nodeId];
  if (!node || !node.expandable) return { doc, added: [] };

  const rng = new Rng((doc.seed ^ hashString(nodeId)) >>> 0);
  const ctx = buildTextContext(doc.prompt);
  const catalogue: RuleCatalogue = {
    rules: activeRules(packs, doc.prompt.archetypes),
    vars: doc.vars,
  };

  const nextNodeId = counterFactory('n', new Set(Object.keys(doc.nodes)));
  const nextEdgeId = counterFactory('e', new Set(Object.keys(doc.edges)));
  const nodes: Record<NodeId, SimNode> = { ...doc.nodes };
  const edges: Record<EdgeId, SimEdge> = { ...doc.edges };
  const branches: Record<BranchId, Branch> = { ...doc.branches };
  const layout: Record<NodeId, LayoutPoint> = { ...doc.layout };

  const added: NodeId[] = [];
  const parentBranch = doc.branches[node.branch];
  const baseHue = parentBranch?.hue ?? 0;

  const runState: RunState = {
    state: node.state ?? derive({}, doc.prompt.archetypes),
    t: node.t,
    usage: USAGE_EMPTY(),
  };

  const riskBias = 0;

  const fork = rng.next() < 0.42 && Object.keys(branches).length < LIMITS.maxBranches - 1;

  if (fork) {
    // A new decision point: two mutually exclusive follow-ons.
    const decisionId = nextNodeId();
    const questionBank = [
      'Which of these two directions do you commit to?',
      'When the next opening appears, do you push or do you consolidate?',
      'Do you trade certainty for upside, or the reverse?',
    ];
    const question =
      questionBank[rng.int(0, questionBank.length - 1)] ?? (questionBank[0] as string);

    const variants = rng.shuffle([
      { id: 'push', label: 'Push for the upside', bias: 0.16 },
      { id: 'consolidate', label: 'Consolidate and protect gains', bias: -0.12 },
    ]);

    nodes[decisionId] = buildNode({
      id: decisionId,
      type: 'decision',
      title: 'The next fork',
      summary: `The path has reached a point where continuing as before is no longer the only option. What happens next depends on whether you push for the upside or consolidate what you have built.`,
      detail: question,
      t: runState.t,
      horizon: doc.prompt.horizon,
      branch: node.branch,
      depth: node.depth + 1,
      rule: null,
      state: runState.state,
      delta: [],
      evidence: [
        {
          cls: 'assumption',
          text: 'Generated by the model as a plausible next decision point. You may know of a better one.',
        },
      ],
      question,
      options: variants.map((v) => ({ id: v.id, label: v.label })),
      expandable: false,
      expanded: true,
    });

    // Mark the node the user expanded as consumed; `link` below adopts the new child.
    const parentNode = { ...(nodes[nodeId] as SimNode) };
    parentNode.expanded = true;
    nodes[nodeId] = parentNode;

    link(
      edges,
      nodes,
      nextEdgeId,
      nodeId,
      decisionId,
      'choice',
      question,
      'The model represents this as an explicit fork rather than a single deterministic continuation, because at this point both directions are genuinely available.',
      'low'
    );
    added.push(decisionId);

    for (let i = 0; i < 2; i += 1) {
      const variant = variants[i] as { id: string; label: string; bias: number };
      if (Object.keys(nodes).length >= LIMITS.maxNodes) break;

      const branchId = `b${nextBranchNumber(branches)}`;
      const segRun: RunState = { ...runState, usage: USAGE_EMPTY() };
      const created = simulateSegment({
        catalogue,
        prompt: doc.prompt,
        ctx,
        rng,
        runState: segRun,
        branchId,
        depth: node.depth + 2,
        parentId: decisionId,
        maxSteps: LIMITS.expansionSteps,
        nextNodeId,
        nextEdgeId,
        nodes,
        edges,
        riskBias: variant.bias,
      });

      // Register the branch only now, so its root is a real node rather than a placeholder.
      branches[branchId] = makeBranch(
        branchId,
        `${parentBranch?.name ?? 'Path'} — ${variant.label.toLowerCase()}`,
        (baseHue + (i === 0 ? 14 : -14) + 360) % 360,
        created[0] ?? decisionId,
        `${variant.label}, following: ${node.title}`
      );

      // Re-parent whatever the segment produced onto the new branch id.
      for (const cid of created) {
        const child = nodes[cid];
        if (child) nodes[cid] = { ...child, branch: branchId };
      }

      // The edge that opened this sub-branch is a choice, not a causal link.
      const firstChild = created[0];
      if (firstChild) {
        const edgeKey = Object.keys(edges).find((k) => edges[k]?.to === firstChild);
        if (edgeKey && edges[edgeKey]) {
          const e = edges[edgeKey] as SimEdge;
          edges[edgeKey] = { ...e, kind: 'choice', label: variant.label };
        }
      }
      added.push(...created);
    }
  } else {
    const created = simulateSegment({
      catalogue,
      prompt: doc.prompt,
      ctx,
      rng,
      runState,
      branchId: node.branch,
      depth: node.depth + 1,
      parentId: nodeId,
      maxSteps: LIMITS.expansionSteps,
      nextNodeId,
      nextEdgeId,
      nodes,
      edges,
      riskBias,
    });

    // `link` inside simulateSegment already adopted created[0] as this node's child.
    const parentNode = { ...(nodes[nodeId] as SimNode) };
    parentNode.expanded = true;
    nodes[nodeId] = parentNode;

    added.push(...created);
  }

  const updated: SimulationDoc = {
    ...doc,
    nodes,
    edges,
    branches,
    layout,
    updatedAt: new Date().toISOString(),
  };

  return { doc: updated, added };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Monte Carlo spread (explicitly labelled as model spread, not outcome probability)
// ---------------------------------------------------------------------------

export interface Spread {
  key: string;
  p10: number;
  p50: number;
  p90: number;
  samples: number;
}

/**
 * Re-runs the branch with different seeds and reports the spread of a metric.
 *
 * This is the only place stochastic sampling is used. It is always presented to the user as
 * "model spread under these stated assumptions", never as the probability of a real outcome.
 */
export function outcomeSpread(
  doc: SimulationDoc,
  nodeId: NodeId,
  packs: readonly RulePack[],
  metricKey: string,
  samples = 24
): Spread | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  const path = pathTo(doc, nodeId);
  if (path.length === 0) return null;

  const values: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const rng = new Rng((doc.seed + hashString(`${nodeId}:${i}`)) >>> 0);
    let state: StateVector = node.state ?? {};
    let t = node.t;
    const usage = USAGE_EMPTY();
    for (let step = 0; step < 6; step += 1) {
      const rule = pickRule(
        rng,
        activeRules(packs, doc.prompt.archetypes),
        state,
        t,
        doc.prompt.imagination,
        0,
        usage
      );
      if (!rule) break;
      const months = Math.max(1, Math.min(rule.durationMonths, doc.prompt.horizon - t));
      const timePassed = accrue(state, months);
      const applied = applyEffects(timePassed.state, rule.effects, doc.vars, rng);
      state = derive(applied.state, doc.prompt.archetypes);
      t += months;
      usage.last.set(rule.id, t);
      if (rule.once) usage.once.add(rule.id);
    }
    values.push(state[metricKey] ?? 0);
  }

  values.sort((a, b) => a - b);
  return {
    key: metricKey,
    p10: percentileOf(values, 0.1),
    p50: percentileOf(values, 0.5),
    p90: percentileOf(values, 0.9),
    samples,
  };
}

function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Path queries
// ---------------------------------------------------------------------------

/**
 * The chain of node ids from the start node down to `nodeId`. */
export function pathTo(doc: SimulationDoc, nodeId: NodeId): NodeId[] {
  const node = doc.nodes[nodeId];
  if (!node) return [];
  const chain: NodeId[] = [nodeId];
  let guard = 0;
  let current = node;
  while (current.parents.length > 0 && guard < 200) {
    const parent = doc.nodes[current.parents[0] as NodeId];
    if (!parent) break;
    chain.unshift(parent.id);
    current = parent;
    guard += 1;
  }
  return chain;
}

/** All nodes reachable from `nodeId` (its subtree). */
export function subtreeOf(doc: SimulationDoc, nodeId: NodeId): Set<NodeId> {
  const out = new Set<NodeId>();
  const stack: NodeId[] = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    if (out.has(id)) continue;
    out.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    for (const child of node.children) stack.push(child);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assumption editing
// ---------------------------------------------------------------------------

/**
 * Rebuilds the monetary base of a universe after the user edits an assumption.
 *
 * Only the *initial* state is recomputed. Event nodes already generated are left exactly as
 * they were — rewriting history to match a new assumption would be dishonest about what the
 * model actually did, and would also destroy the user's graph. The returned document therefore
 * carries the new starting point, and the UI is explicit that existing nodes were computed
 * under the previous value.
 */
export function updateAssumptions(
  doc: SimulationDoc,
  overrides: Record<string, number>
): SimulationDoc {
  const assumptions = doc.assumptions.map((a) =>
    overrides[a.id] !== undefined ? { ...a, value: overrides[a.id] as number } : a
  );

  const patch: StateVector = {};
  for (const a of assumptions) {
    if (a.varKey === 'money' || a.varKey === 'income' || a.varKey === 'expenses') {
      patch[a.varKey] = a.value;
    }
  }
  const horizonOverride = assumptions.find((a) => a.id === 'a.horizon');
  const horizon = horizonOverride ? Math.round(horizonOverride.value) : doc.prompt.horizon;

  const nodes: Record<NodeId, SimNode> = {};
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'start' && node.state) {
      const merged = derive({ ...node.state, ...patch }, doc.prompt.archetypes);
      nodes[node.id] = { ...node, state: merged };
    } else {
      nodes[node.id] = node;
    }
  }

  return {
    ...doc,
    nodes,
    assumptions,
    prompt: { ...doc.prompt, horizon: Math.max(6, Math.min(horizon, 240)) },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Projects a branch forward from a node under the current assumptions and seed, and returns
 * the resulting state. Used for the assumption-sensitivity diagnostic and for "where does this
 * path lead" previews. Deterministic for a given (doc, nodeId, extraYears).
 */
export function forecastFrom(
  doc: SimulationDoc,
  nodeId: NodeId,
  packs: readonly RulePack[],
  extraMonths: number
): StateVector | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;

  const state: StateVector = derive(node.state ?? {}, doc.prompt.archetypes);
  const rng = new Rng((doc.seed + hashString(`${nodeId}:forecast`)) >>> 0);
  const catalogue = activeRules(packs, doc.prompt.archetypes);
  const usage = USAGE_EMPTY();
  let t = node.t;
  const end = Math.max(doc.prompt.horizon, t + extraMonths);
  let guard = 0;

  while (t < end && guard < 40) {
    guard += 1;
    const rule = pickRule(rng, catalogue, state, t, doc.prompt.imagination, 0, usage);
    if (!rule) break;
    const months = Math.max(1, Math.min(rule.durationMonths, end - t));
    const timePassed = accrue(state, months);
    const applied = applyEffects(timePassed.state, rule.effects, doc.vars, rng);
    const next = derive(applied.state, doc.prompt.archetypes);
    for (const key of Object.keys(next)) state[key] = next[key] as number;
    t += months;
    usage.last.set(rule.id, t);
    if (rule.once) usage.once.add(rule.id);
  }
  return state;
}
