/**
 * Counterfactuals: the "what if I changed this?" feature.
 *
 * Two kinds are supported:
 *
 *  1. **Assumption counterfactuals** — change a number (funds, income, costs) and rebuild the
 *     universe around it.
 *  2. **Decision counterfactuals** — change which branch you took.
 *
 * In both cases the original document is never modified. A new document is produced with its
 * own id and a `parentId` back to the original, so the user can always return to what they had.
 *
 * A deliberate design rule: the comparison never claims that the counterfactual outcome is
 * what "would have" happened. It reports which modelled quantities moved, which assumptions
 * changed, and which conclusions are sensitive to uncertain inputs — and labels all of it as
 * model behaviour rather than fact.
 */
import { Rng } from './rng';
import { applyEffects, type RulePack } from './rulePack';
import { createUniverse, derive, forecastFrom, hashString } from './engine';
import { optionById } from './archetypes';
import { ALL_VARS } from './packs/vars';
import { edgeList, type Assumption, type Counterfactual, type NodeId, type SimNode, type SimulationDoc, type StateVector } from './types';
import { formatValue, getState } from './vars';

export interface DiffEntry {
  key: string;
  label: string;
  from: number;
  to: number;
  delta: number;
  unit: Assumption['unit'];
  /** How far along the branch the divergence first becomes visible, in months. */
  divergesAtMonths: number | null;
}

export interface CounterfactualResult {
  doc: SimulationDoc;
  counterfactual: Counterfactual;
}

// ---------------------------------------------------------------------------
// Assumption counterfactuals
// ---------------------------------------------------------------------------

/**
 * Produces a new universe with one assumption changed.
 *
 * The new universe is regenerated from the same seed and prompt with the edited starting
 * value, so the two documents differ only because of the changed assumption — which is exactly
 * what makes the comparison meaningful.
 */
export function applyAssumptionChange(
  doc: SimulationDoc,
  assumptionId: string,
  newValue: number,
  packs: readonly RulePack[],
  note = '',
): CounterfactualResult | { error: string } {
  const assumption = doc.assumptions.find((a) => a.id === assumptionId);
  if (!assumption) return { error: `Assumption "${assumptionId}" does not exist.` };
  if (!assumption.editable) return { error: `Assumption "${assumption.label}" cannot be edited.` };
  if (!Number.isFinite(newValue)) return { error: 'The new value must be a finite number.' };
  if (newValue === assumption.value) return { error: 'The new value is identical to the current value.' };

  const overrides: Record<string, number> = {};
  for (const a of doc.assumptions) overrides[a.id] = a.value;
  overrides[assumptionId] = newValue;

  const rebuilt = createUniverse(
    { packs, seed: doc.seed, prompt: doc.prompt },
    {
      seed: doc.seed,
      branchCount: doc.prompt.branchCount,
      assumptionOverrides: overrides,
      title: `${doc.title} — ${assumption.label.toLowerCase()} changed`,
    },
  );

  const counterfactual: Counterfactual = {
    target: assumption.label,
    fromValue: formatValue(assumption.value, assumption.unit),
    toValue: formatValue(newValue, assumption.unit),
    note:
      note ||
      `Rebuilt from the same seed with ${assumption.label.toLowerCase()} set to ${formatValue(newValue, assumption.unit)} instead of ${formatValue(assumption.value, assumption.unit)}.`,
    createdAt: new Date().toISOString(),
  };

  const stamped: SimulationDoc = {
    ...rebuilt,
    parentId: doc.id,
    counterfactual,
    meta: {
      ...rebuilt.meta,
      provenance: `Derived from "${doc.title}" (${doc.id}) by changing ${assumption.label}. Same seed, same prompt, one different starting value.`,
    },
  };

  return { doc: withSensitivity(stamped, packs), counterfactual };
}

// ---------------------------------------------------------------------------
// Decision counterfactuals
// ---------------------------------------------------------------------------

/** Produces a universe that assumes a single different initial decision was taken. */
export function applyDecisionChange(
  doc: SimulationDoc,
  optionId: string,
  packs: readonly RulePack[],
): CounterfactualResult | { error: string } {
  const option = optionById(optionId);
  if (!option) return { error: `Unknown decision "${optionId}".` };

  // Identify the decision currently in force at the head of the tree, if the caller did not
  // tell us which branch they were looking at.
  const current = currentDecisionLabels(doc);
  if (current.includes(option.label)) {
    return { error: `"${option.label}" is already one of the branches in this universe.` };
  }

  const overrides: Record<string, number> = {};
  for (const a of doc.assumptions) overrides[a.id] = a.value;

  const rebuilt = createUniverse(
    { packs, seed: doc.seed, prompt: doc.prompt },
    {
      seed: doc.seed,
      branchCount: 1,
      onlyOptionId: optionId,
      assumptionOverrides: overrides,
      title: `${doc.title} — if you had chosen ${option.label.toLowerCase()}`,
    },
  );

  const counterfactual: Counterfactual = {
    target: 'Initial decision',
    fromValue: current.join(' / ') || 'the current branch set',
    toValue: option.label,
    note: `Rebuilt as a single-branch universe where "${option.label}" is the only initial commitment. The original branch set is untouched in the parent universe.`,
    createdAt: new Date().toISOString(),
  };

  const stamped: SimulationDoc = {
    ...rebuilt,
    parentId: doc.id,
    counterfactual,
    meta: {
      ...rebuilt.meta,
      provenance: `Derived from "${doc.title}" (${doc.id}) by assuming a different initial decision: ${option.label}.`,
    },
  };

  return { doc: withSensitivity(stamped, packs), counterfactual };
}

function currentDecisionLabels(doc: SimulationDoc): string[] {
  return Object.values(doc.nodes)
    .filter((n) => n.depth === 1 && n.type === 'decision')
    .map((n) => n.title);
}

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

/**
 * Estimates how much each editable assumption influences the headline metric, by perturbing it
 * and re-forecasting from the existing end-points of the graph.
 *
 * This is a diagnostic, not a probability. It is only ever rendered as "how sensitive is this
 * result to this number", never as "this will happen".
 */
export function withSensitivity(doc: SimulationDoc, packs: readonly RulePack[]): SimulationDoc {
  const endpoints = Object.values(doc.nodes)
    .filter((n) => n.children.length === 0 && n.state)
    .slice(0, 20);
  if (endpoints.length === 0) return doc;

  const assumptions = doc.assumptions.map((a) => {
    if (!a.editable) return a;
    const spread = Math.abs(a.value) > 0 ? Math.abs(a.value) * 0.25 : 500;
    const perturbed: SimulationDoc = {
      ...doc,
      assumptions: doc.assumptions.map((x) =>
        x.id === a.id ? { ...x, value: x.value + spread } : x,
      ),
    };

    let total = 0;
    let count = 0;
    for (const endpoint of endpoints) {
      const before = forecastFrom(doc, endpoint.id, packs, 0);
      const after = forecastFrom(perturbed, endpoint.id, packs, 0);
      if (!before || !after) continue;
      total += Math.abs(getState(after, 'goalProgress') - getState(before, 'goalProgress'));
      count += 1;
    }
    if (count === 0) return a;
    return { ...a, sensitivity: Math.min(1, total / count / 25) };
  });

  return { ...doc, assumptions };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface BranchSnapshot {
  nodeId: NodeId;
  title: string;
  branchName: string;
  hue: number;
  horizon: string;
  state: StateVector;
  delta: { key: string; before: number; after: number; reason: string }[];
  assumptions: string[];
  uncertainties: string[];
  tradeoffs?: { gains: string[]; costs: string[] };
  failurePoints?: string[];
  nextSteps?: string[];
  evidenceCls: string[];
  /** Month at which this branch diverged from the comparison baseline, if known. */
  divergedAtMonths: number | null;
}

/** Collects a comparison-ready snapshot of a node. */
export function snapshot(doc: SimulationDoc, nodeId: NodeId): BranchSnapshot | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  const branch = doc.branches[node.branch];
  return {
    nodeId: node.id,
    title: node.title,
    branchName: branch?.name ?? 'This path',
    hue: branch?.hue ?? 0,
    horizon: node.horizon,
    state: node.state ?? {},
    delta: node.delta ?? [],
    assumptions: node.assumptions,
    uncertainties: node.uncertainties,
    ...(node.tradeoffs ? { tradeoffs: node.tradeoffs } : {}),
    ...(node.failurePoints ? { failurePoints: node.failurePoints } : {}),
    ...(node.nextSteps ? { nextSteps: node.nextSteps } : {}),
    evidenceCls: node.evidence.map((e) => e.cls),
    divergedAtMonths: node.t,
  };
}

/**
 * Diffs two snapshots over the union of their state keys.
 *
 * Only keys whose difference exceeds the variable's noise floor are reported, so the table does
 * not fill with meaningless 0.1-point differences that are artefacts of the model rather than
 * signal.
 */
export function diffSnapshots(a: BranchSnapshot, b: BranchSnapshot): DiffEntry[] {
  const keys = new Set([...Object.keys(a.state), ...Object.keys(b.state)]);
  const out: DiffEntry[] = [];

  for (const key of keys) {
    const def = ALL_VARS.find((v) => v.key === key);
    if (!def) continue;
    const from = getState(a.state, key);
    const to = getState(b.state, key);
    const delta = to - from;
    const floor = def.unit === 'currency' ? 50 : def.unit === 'months' ? 0.5 : 0.75;
    if (Math.abs(delta) < floor) continue;
    out.push({
      key,
      label: def.label,
      from,
      to,
      delta,
      unit: def.unit,
      divergesAtMonths: a.divergedAtMonths !== b.divergedAtMonths ? Math.min(a.divergedAtMonths ?? 0, b.divergedAtMonths ?? 0) : null,
    });
  }

  // Largest absolute movement first, so the consequential differences lead.
  out.sort((x, y) => {
    const xn = normalise(x), yn = normalise(y);
    return yn - xn;
  });
  return out;
}

function normalise(entry: DiffEntry): number {
  const scale = entry.unit === 'currency' ? 1000 : entry.unit === 'months' ? 6 : 20;
  return Math.abs(entry.delta) / scale;
}

/**
 * Classifies each state key by whether it moved between two branch snapshots, and by whether
 * the movement is larger than the modelled noise for that key. This is what powers the
 * "which conclusions are stable" panel — it distinguishes genuine differences from the model's
 * own jitter.
 */
export interface StabilityReport {
  stable: string[];
  moved: string[];
  sensitive: string[];
}

export function stabilityBetween(
  a: BranchSnapshot,
  b: BranchSnapshot,
  noisyKeys: readonly string[],
): StabilityReport {
  const noisy = new Set(noisyKeys);
  const diffs = diffSnapshots(a, b);
  const movedKeys = new Set(diffs.map((d) => d.key));
  const stable: string[] = [];
  const moved: string[] = [];
  const sensitive: string[] = [];

  const keys = new Set([...Object.keys(a.state), ...Object.keys(b.state)]);
  for (const key of keys) {
    const def = ALL_VARS.find((v) => v.key === key);
    if (!def) continue;
    if (movedKeys.has(key)) {
      if (noisy.has(key)) sensitive.push(def.label);
      else moved.push(def.label);
    } else {
      stable.push(def.label);
    }
  }

  return { stable, moved, sensitive };
}

/** State keys whose rules inject material noise, i.e. where small differences mean little. */
export function noisyKeys(packs: readonly RulePack[]): string[] {
  const out = new Set<string>();
  for (const pack of packs) {
    for (const rule of pack.rules) {
      for (const eff of rule.effects) {
        if (eff.noise && eff.noise > 0.15) out.add(eff.key);
      }
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Assumption-only diff (no regeneration needed)
// ---------------------------------------------------------------------------

/** Lists the assumptions that differ between a document and its parent's recorded values. */
export function changedAssumptions(parent: SimulationDoc, child: SimulationDoc): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const a of parent.assumptions) {
    const b = child.assumptions.find((x) => x.id === a.id);
    if (!b || Math.abs(a.value - b.value) < 1e-9) continue;
    out.push({
      key: a.id,
      label: a.label,
      from: a.value,
      to: b.value,
      delta: b.value - a.value,
      unit: a.unit,
      divergesAtMonths: 0,
    });
  }
  return out;
}

/**
 * A short, honest "why this path?" explanation assembled from the edges and rule metadata on
 * the chain to a node. Deliberately describes the model's reasoning rather than promising
 * anything about reality.
 */
export function whyThisPath(doc: SimulationDoc, nodeId: NodeId): string[] {
  const reasons: string[] = [];
  const chain: NodeId[] = [];
  let cursor: NodeId | undefined = nodeId;
  let guard = 0;
  while (cursor && guard < 60) {
    guard += 1;
    const node: SimNode | undefined = doc.nodes[cursor];
    if (!node) break;
    chain.unshift(node.id);
    cursor = node.parents[0];
  }

  for (const id of chain) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.type === 'start') {
      reasons.push(`Started from: ${node.title}. The model treats this as given, because you said it.`);
      continue;
    }
    const incoming = edgeList(doc).find((e) => e.to === id);
    if (incoming && incoming.kind === 'choice') {
      reasons.push(`A deliberate choice at ${node.horizon}: ${node.title}.`);
    } else if (incoming) {
      const rule = node.ruleId ? ` (rule ${node.ruleId})` : '';
      reasons.push(`At ${node.horizon}: ${node.title}, triggered by the state reached earlier${rule}.`);
    }
    if (node.assumptions.length > 0) {
      reasons.push(`That step assumed: ${node.assumptions[0]}`);
    }
  }

  if (nodeId) {
    const last = doc.nodes[nodeId];
    if (last && last.uncertainties.length > 0) {
      reasons.push(`Least certain part of this path: ${last.uncertainties[0]}`);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Seed-based re-roll (explicit and labelled)
// ---------------------------------------------------------------------------

/** Re-runs the whole universe with a new seed. Returned document is always marked as derived. */
export function reroll(
  doc: SimulationDoc,
  packs: readonly RulePack[],
  seed: number,
): SimulationDoc {
  const rebuilt = createUniverse(
    { packs, seed, prompt: doc.prompt },
    {
      seed,
      branchCount: doc.prompt.branchCount,
      assumptionOverrides: Object.fromEntries(doc.assumptions.map((a) => [a.id, a.value])),
      title: doc.title,
    },
  );
  return {
    ...rebuilt,
    id: doc.id,
    createdAt: doc.createdAt,
    parentId: doc.parentId,
    counterfactual: {
      target: 'Random seed',
      fromValue: String(doc.seed),
      toValue: String(seed),
      note: 'The same scenario re-run with a different seed. Figures will differ; the structure of the model will not.',
      createdAt: new Date().toISOString(),
    },
    meta: {
      ...rebuilt.meta,
      provenance: `Re-run of the same scenario with seed ${seed}. Same rules, same assumptions, different draw.`,
    },
  };
}

/** Applies a single state patch to a node's branch, used by assumption previews. */
export function previewAssumption(
  state: StateVector,
  assumption: Assumption,
  value: number,
  archetypes: readonly string[],
): StateVector {
  const next: StateVector = { ...state, [assumption.varKey]: value };
  return derive(next, archetypes);
}

/** Small helper for tests and diagnostics: the initial state of a single option. */
export function singleBranchState(
  doc: SimulationDoc,
  optionId: string,
): StateVector | null {
  const option = optionById(optionId);
  if (!option) return null;
  const rng = new Rng((doc.seed ^ hashString(optionId)) >>> 0);
  const base = derive({}, doc.prompt.archetypes);
  const applied = applyEffects(base, option.effects, doc.vars.length > 0 ? doc.vars : ALL_VARS, rng);
  return derive(applied.state, doc.prompt.archetypes);
}
