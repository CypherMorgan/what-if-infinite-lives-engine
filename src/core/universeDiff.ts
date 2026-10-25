/**
 * Universe diff — the same decision, modelled twice.
 *
 * A branch diff answers "which of these two paths is different, and where do
 * they part company?". This module answers the other question a person asks
 * after forking a universe: "what did I change, and what did it actually do?"
 *
 * The comparison is deliberately conservative about what it claims:
 *
 *  - It reports the assumptions that differ between the two documents. When one
 *    universe was forked from the other, that fork's own record of the change is
 *    shown too, so a decision fork (which is not an assumption change) is not
 *    silently invisible.
 *  - It only compares paths that correspond. Paths are paired by name, because
 *    branch ids are positional and would falsely pair two unrelated answers.
 *    When a fork commits to a different decision, the paths no longer
 *    correspond, and the diff says so instead of inventing a pairing.
 *  - It says when the two universes answer different questions, when they were
 *    run with different random draws, and when their setups differ in ways that
 *    are not assumptions. Those are the reasons a difference might not be
 *    attributable to the changed assumption.
 *
 * Nothing here is scored or recommended. "Favours" is the direction the
 * variable's own definition calls better, exactly as in the branch diff.
 */
import { branchEndNode } from './branchDiff';
import { compareStates, largestGaps, signedText, type StateDiffMetric } from './compareMetrics';
import { forecastFrom } from './engine';
import { describeHorizon } from './graphLegend';
import type { RulePack } from './rulePack';
import type {
  Assumption,
  Branch,
  BranchId,
  Counterfactual,
  NodeId,
  SimId,
  SimulationDoc,
  VarUnit,
} from './types';
import { formatValue } from './vars';

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

/** The minimum a universe needs to expose for lineage to be worked out. */
export interface UniverseRef {
  id: SimId;
  title: string;
  parentId?: SimId;
}

export type UniverseRelationKind =
  'same' | 'b-from-a' | 'a-from-b' | 'siblings' | 'related' | 'unrelated';

export interface UniverseRelation {
  kind: UniverseRelationKind;
  commonAncestor: {
    id: SimId;
    title: string;
    stepsFromA: number;
    stepsFromB: number;
  } | null;
  /** One plain sentence describing how the two universes are connected. */
  label: string;
  /** True when a recorded parent could not be found in the refs supplied. */
  incomplete: boolean;
}

/**
 * Works out how two universes are related.
 *
 * `refs` only needs to contain the universes whose lineage the caller can see
 * — in the app, the library index. Missing parents are reported as
 * `incomplete` rather than silently treated as "unrelated".
 */
export function relateUniverses(
  a: UniverseRef,
  b: UniverseRef,
  refs: readonly UniverseRef[]
): UniverseRelation {
  if (a.id === b.id) {
    return {
      kind: 'same',
      commonAncestor: { id: a.id, title: a.title, stepsFromA: 0, stepsFromB: 0 },
      label: 'This is the same universe compared with itself.',
      incomplete: false,
    };
  }

  const byId = new Map<SimId, UniverseRef>();
  for (const ref of refs) byId.set(ref.id, ref);
  byId.set(a.id, a);
  byId.set(b.id, b);

  const chainA = ancestorChain(a, byId);
  const chainB = ancestorChain(b, byId);
  const incomplete = chainA.incomplete || chainB.incomplete;

  // Is one an ancestor of the other?
  const bAt = chainA.chain.findIndex((x) => x.id === b.id);
  if (bAt > 0) {
    return {
      kind: 'a-from-b',
      commonAncestor: { id: b.id, title: b.title, stepsFromA: bAt, stepsFromB: 0 },
      label:
        bAt === 1
          ? `“${a.title}” was derived from “${b.title}”.`
          : `“${a.title}” descends from “${b.title}” (${bAt} forks later).`,
      incomplete,
    };
  }
  const aAt = chainB.chain.findIndex((x) => x.id === a.id);
  if (aAt > 0) {
    return {
      kind: 'b-from-a',
      commonAncestor: { id: a.id, title: a.title, stepsFromA: 0, stepsFromB: aAt },
      label:
        aAt === 1
          ? `“${b.title}” was derived from “${a.title}”.`
          : `“${b.title}” descends from “${a.title}” (${aAt} forks later).`,
      incomplete,
    };
  }

  // Do they share an ancestor?
  for (let i = 0; i < chainA.chain.length; i += 1) {
    const candidate = chainA.chain[i] as UniverseRef;
    const j = chainB.chain.findIndex((x) => x.id === candidate.id);
    if (j < 0) continue;
    if (i === 0 && j === 0) break; // the same universe, handled above
    const kind: UniverseRelationKind = i === 1 && j === 1 ? 'siblings' : 'related';
    return {
      kind,
      commonAncestor: {
        id: candidate.id,
        title: candidate.title,
        stepsFromA: i,
        stepsFromB: j,
      },
      label:
        kind === 'siblings'
          ? `Both are forks of “${candidate.title}”.`
          : `Both descend from “${candidate.title}”.`,
      incomplete,
    };
  }

  return {
    kind: 'unrelated',
    commonAncestor: null,
    label: incomplete
      ? 'No shared origin is recorded in this library. They may still be related; the parent universes are no longer saved.'
      : 'These universes have no shared origin in this library — they are two separate answers.',
    incomplete,
  };
}

function ancestorChain(
  start: UniverseRef,
  byId: ReadonlyMap<SimId, UniverseRef>
): { chain: UniverseRef[]; incomplete: boolean } {
  const chain: UniverseRef[] = [start];
  const seen = new Set<SimId>([start.id]);
  let current = start;
  let guard = 0;
  while (current.parentId && guard < 40) {
    guard += 1;
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) return { chain, incomplete: true };
    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  if (current.parentId) return { chain, incomplete: true };
  return { chain, incomplete: false };
}

/* ------------------------------------------------------------------ */
/* The diff                                                            */
/* ------------------------------------------------------------------ */

export interface UniverseSide {
  id: SimId;
  title: string;
  seed: number;
  horizon: number;
  createdAt: string;
  nodeCount: number;
  branchCount: number;
  parentId?: SimId;
  counterfactual?: Counterfactual;
}

/** One assumption that is not the same in both universes. */
export interface AssumptionDifference {
  /** Stable assumption id. */
  key: string;
  label: string;
  unit: VarUnit;
  kind: 'changed' | 'only-a' | 'only-b';
  a: number | null;
  b: number | null;
  aText: string;
  bText: string;
  /** "b − a", or an empty string when the assumption exists on one side only. */
  deltaText: string;
  delta: number | null;
}

/** The same path, compared between the two universes. */
export interface UniversePathComparison {
  name: string;
  aBranchId: BranchId;
  bBranchId: BranchId;
  aEndNodeId: NodeId;
  bEndNodeId: NodeId;
  aEndTitle: string;
  bEndTitle: string;
  aEndAtLabel: string;
  bEndAtLabel: string;
  metrics: StateDiffMetric[];
  sameCount: number;
  diffCount: number;
  aAhead: number;
  bAhead: number;
  headline: string;
  verdict: string;
}

/** A path only one of the two universes has. */
export interface UniverseOnlyPath {
  name: string;
  hue: number;
  endTitle: string;
  endAtLabel: string;
}

export interface UniverseDiff {
  a: UniverseSide;
  b: UniverseSide;
  relationship: UniverseRelation;
  /** The forking records that explain how these documents were made. */
  lineageNotes: string[];
  /** True when both describe the same situation and decision. */
  sameQuestion: boolean;
  /** True when both were simulated from the same seed. */
  sameSeed: boolean;
  /** Prompt fields that differ, in plain words. */
  setupDifferences: string[];
  /** Assumptions whose values (or presence) differ. */
  changedAssumptions: AssumptionDifference[];
  /** Assumptions present in both with the same value. */
  sharedAssumptionCount: number;
  /** Paths that correspond in both universes. */
  paths: UniversePathComparison[];
  onlyA: UniverseOnlyPath[];
  onlyB: UniverseOnlyPath[];
  compareMonth: number;
  compareLabel: string;
  headline: string;
  verdict: string;
}

export interface UniverseDiffOptions {
  /** Other universes the caller can see, used only to resolve lineage. */
  refs?: readonly UniverseRef[];
}

/**
 * Builds the diff between two universes.
 *
 * Neither document is modified. Returns null only when one of the documents is
 * missing an identifiable start state; an empty comparison is a real answer and
 * is reported as such.
 */
export function buildUniverseDiff(
  aDoc: SimulationDoc,
  bDoc: SimulationDoc,
  packs: readonly RulePack[],
  options: UniverseDiffOptions = {}
): UniverseDiff {
  const a = sideFrom(aDoc);
  const b = sideFrom(bDoc);
  const refs = [...(options.refs ?? []), refOf(aDoc), refOf(bDoc)];
  const relationship = relateUniverses(refOf(aDoc), refOf(bDoc), refs);

  const { changedAssumptions, sharedAssumptionCount } = compareAssumptions(aDoc, bDoc);
  const setupDifferences = describeSetupDifferences(aDoc, bDoc);
  const sameQuestion =
    normalise(aDoc.prompt.situation) === normalise(bDoc.prompt.situation) &&
    normalise(aDoc.prompt.decision) === normalise(bDoc.prompt.decision);
  const sameSeed = aDoc.seed === bDoc.seed;

  const lineageNotes = lineageNoteList(relationship.kind, aDoc, bDoc);

  /* ---------------- which paths correspond ---------------- */

  const pairs = pairBranches(aDoc, bDoc);
  const onlyA: UniverseOnlyPath[] = pairs
    .filter((p) => !p.b)
    .map((p) => onlyPath(aDoc, p.a as Branch));
  const onlyB: UniverseOnlyPath[] = pairs
    .filter((p) => !p.a)
    .map((p) => onlyPath(bDoc, p.b as Branch));

  const matched = pairs.filter((p): p is { a: Branch; b: Branch } => p.a !== null && p.b !== null);

  // The comparison moment is the furthest horizon either universe models, or
  // the furthest step either side actually reached.
  const endMonths: number[] = [];
  for (const branch of Object.values(aDoc.branches)) {
    const end = branchEndNode(aDoc, branch.id);
    if (end) endMonths.push(end.t);
  }
  for (const branch of Object.values(bDoc.branches)) {
    const end = branchEndNode(bDoc, branch.id);
    if (end) endMonths.push(end.t);
  }
  const compareMonth = Math.max(aDoc.prompt.horizon, bDoc.prompt.horizon, ...endMonths);
  const compareLabel = describeHorizon(compareMonth);

  const paths = matched
    .map((pair) => comparePath(pair, aDoc, bDoc, packs, compareMonth, compareLabel))
    .filter((p): p is UniversePathComparison => p !== null)
    .sort((x, y) => y.diffCount - x.diffCount || x.name.localeCompare(y.name));

  /* ---------------- the wording ---------------- */

  const totalDiffs = paths.reduce((sum, p) => sum + p.diffCount, 0);
  const aAhead = paths.reduce((sum, p) => sum + p.aAhead, 0);
  const bAhead = paths.reduce((sum, p) => sum + p.bAhead, 0);

  let headline = '';
  if (!sameQuestion) {
    headline += 'These universes answer different questions. ';
  }
  if (paths.length === 0) {
    headline +=
      changedAssumptions.length > 0
        ? `Their setups differ on ${count(changedAssumptions.length, 'assumption')}, but they share no path — so there is no like-for-like outcome comparison.`
        : 'They share no path — so there is no like-for-like outcome comparison. What differs in the setup is listed above.';
  } else if (changedAssumptions.length === 0) {
    headline += `The setups start from the same assumptions. Across the ${count(paths.length, 'path')} both universes share, ${totalDiffs === 0 ? 'the model finds nothing different' : `${count(totalDiffs, 'measurement')} still end up different`} at ${compareLabel}.`;
  } else {
    headline += `The setups differ on ${count(changedAssumptions.length, 'assumption')}. Across the ${count(paths.length, 'path')} both universes share, ${totalDiffs === 0 ? 'the model finds nothing different' : `${count(totalDiffs, 'measurement')} end up different`} at ${compareLabel}.`;
  }

  const verdictNotes: string[] = [];
  if (!sameQuestion) {
    verdictNotes.push(
      'Different questions: read this as two separate answers, not two versions of one answer.'
    );
  } else if (!sameSeed) {
    verdictNotes.push(
      'Same question, different random draws: part of any difference comes from the draw, not from the assumptions.'
    );
  } else if (setupDifferences.length === 0 && changedAssumptions.length > 0) {
    verdictNotes.push(
      'Same question, same random draw: the changed assumptions are the only setup difference, so the outcome difference can be traced to them.'
    );
  } else if (setupDifferences.length === 0) {
    verdictNotes.push('Same question, same random draw, same starting assumptions.');
  }

  if (setupDifferences.length > 0) {
    verdictNotes.push(`The setups also differ in ${joinList(setupDifferences)}.`);
  }

  if (paths.length > 0) {
    if (totalDiffs === 0) {
      verdictNotes.push('On the paths they share, the model finds nothing different to weigh.');
    } else if (aAhead === bAhead) {
      verdictNotes.push(
        aAhead === 0
          ? 'The model sees no clearly better side on the differences it reports.'
          : `The ${count(totalDiffs, 'difference')} split evenly: ${aAhead} favour “${a.title}”, ${bAhead} favour “${b.title}”.`
      );
    } else {
      const winner = aAhead > bAhead ? a : b;
      const countAhead = Math.max(aAhead, bAhead);
      verdictNotes.push(
        `${countAhead} of the ${count(totalDiffs, 'difference')} favour “${winner.title}”.`
      );
    }
  }

  return {
    a,
    b,
    relationship,
    lineageNotes,
    sameQuestion,
    sameSeed,
    setupDifferences,
    changedAssumptions,
    sharedAssumptionCount,
    paths,
    onlyA,
    onlyB,
    compareMonth,
    compareLabel,
    headline,
    verdict: verdictNotes.join(' '),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function refOf(doc: SimulationDoc): UniverseRef {
  return {
    id: doc.id,
    title: doc.title,
    ...(doc.parentId ? { parentId: doc.parentId } : {}),
  };
}

function sideFrom(doc: SimulationDoc): UniverseSide {
  return {
    id: doc.id,
    title: doc.title,
    seed: doc.seed,
    horizon: doc.prompt.horizon,
    createdAt: doc.createdAt,
    nodeCount: Object.keys(doc.nodes).length,
    branchCount: Object.keys(doc.branches).length,
    ...(doc.parentId ? { parentId: doc.parentId } : {}),
    ...(doc.counterfactual ? { counterfactual: doc.counterfactual } : {}),
  };
}

function compareAssumptions(
  aDoc: SimulationDoc,
  bDoc: SimulationDoc
): { changedAssumptions: AssumptionDifference[]; sharedAssumptionCount: number } {
  const aById = new Map(aDoc.assumptions.map((x) => [x.id, x]));
  const bById = new Map(bDoc.assumptions.map((x) => [x.id, x]));
  const keys: string[] = [];
  for (const key of aById.keys()) keys.push(key);
  for (const key of bById.keys()) if (!aById.has(key)) keys.push(key);

  const out: AssumptionDifference[] = [];
  let sharedAssumptionCount = 0;

  for (const key of keys) {
    const a = aById.get(key);
    const b = bById.get(key);
    if (a && b) {
      const delta = b.value - a.value;
      if (Math.abs(delta) < 1e-9) {
        sharedAssumptionCount += 1;
        continue;
      }
      out.push({
        key,
        label: a.label || b.label,
        unit: a.unit,
        kind: 'changed',
        a: a.value,
        b: b.value,
        aText: formatValue(a.value, a.unit),
        bText: formatValue(b.value, b.unit),
        deltaText: signedText(delta, a.unit),
        delta,
      });
      continue;
    }
    const only = (a ?? b) as Assumption;
    out.push({
      key,
      label: only.label,
      unit: only.unit,
      kind: a ? 'only-a' : 'only-b',
      a: a ? a.value : null,
      b: b ? b.value : null,
      aText: a ? formatValue(a.value, a.unit) : '—',
      bText: b ? formatValue(b.value, b.unit) : '—',
      deltaText: '',
      delta: null,
    });
  }

  // Real changes lead; one-sided assumptions follow, alphabetically.
  out.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'changed' ? -1 : y.kind === 'changed' ? 1 : 0;
    return x.label.localeCompare(y.label);
  });

  return { changedAssumptions: out, sharedAssumptionCount };
}

function describeSetupDifferences(a: SimulationDoc, b: SimulationDoc): string[] {
  const out: string[] = [];
  if (normalise(a.prompt.situation) !== normalise(b.prompt.situation)) {
    out.push('the situation you described');
  }
  if (normalise(a.prompt.decision) !== normalise(b.prompt.decision)) {
    out.push('the decision under consideration');
  }
  if (a.prompt.horizon !== b.prompt.horizon) {
    out.push(`the time horizon (${a.prompt.horizon} vs ${b.prompt.horizon} months)`);
  }
  if (!sameList(a.prompt.goals, b.prompt.goals)) out.push('the stated goals');
  if (!sameList(a.prompt.constraints, b.prompt.constraints)) out.push('the stated constraints');
  if (!sameList(a.prompt.resources, b.prompt.resources)) out.push('the stated resources');
  return out;
}

/** Pairs paths that correspond: by name, never by positional branch id. */
function pairBranches(
  aDoc: SimulationDoc,
  bDoc: SimulationDoc
): { a: Branch | null; b: Branch | null }[] {
  const aBranches = pathBranches(aDoc);
  const bBranches = pathBranches(bDoc);
  const usedB = new Set<BranchId>();
  const pairs: { a: Branch | null; b: Branch | null }[] = [];

  for (const a of aBranches) {
    const match = bBranches.find(
      (b) => !usedB.has(b.id) && normalise(b.name) === normalise(a.name)
    );
    if (match) {
      usedB.add(match.id);
      pairs.push({ a, b: match });
    } else {
      pairs.push({ a, b: null });
    }
  }
  for (const b of bBranches) {
    if (!usedB.has(b.id)) pairs.push({ a: null, b });
  }
  return pairs;
}

function pathBranches(doc: SimulationDoc): Branch[] {
  const startBranch = Object.values(doc.nodes).find((n) => n.type === 'start')?.branch;
  return Object.values(doc.branches).filter((b) => b.id !== startBranch);
}

function onlyPath(doc: SimulationDoc, branch: Branch): UniverseOnlyPath {
  const end = branchEndNode(doc, branch.id);
  return {
    name: branch.name,
    hue: branch.hue,
    endTitle: end?.title ?? 'No steps',
    endAtLabel: end ? (end.t === 0 ? 'now' : `month ${end.t}`) : 'now',
  };
}

function comparePath(
  pair: { a: Branch; b: Branch },
  aDoc: SimulationDoc,
  bDoc: SimulationDoc,
  packs: readonly RulePack[],
  compareMonth: number,
  compareLabel: string
): UniversePathComparison | null {
  const aEnd = branchEndNode(aDoc, pair.a.id);
  const bEnd = branchEndNode(bDoc, pair.b.id);
  if (!aEnd || !bEnd) return null;

  const aState = forecastFrom(aDoc, aEnd.id, packs, Math.max(0, compareMonth - aEnd.t));
  const bState = forecastFrom(bDoc, bEnd.id, packs, Math.max(0, compareMonth - bEnd.t));
  if (!aState || !bState) return null;

  const { metrics, sameCount } = compareStates(aState, bState);
  const aAhead = metrics.filter((m) => m.favours === 'a').length;
  const bAhead = metrics.filter((m) => m.favours === 'b').length;

  const headline =
    metrics.length === 0
      ? `At ${compareLabel}, the model cannot tell this path apart between the two universes.`
      : `At ${compareLabel}, this path differs on ${count(metrics.length, 'thing')}. The largest gaps are ${largestGaps(metrics)}.`;

  let verdict: string;
  if (metrics.length === 0) {
    verdict = 'No difference on the numbers the model tracks.';
  } else if (aAhead === bAhead) {
    verdict =
      aAhead === 0
        ? 'The model sees no clearly better side on these differences.'
        : `The differences split evenly: ${aAhead} favour the first universe, ${bAhead} the second.`;
  } else {
    const winner = aAhead > bAhead ? 'the first universe' : 'the second universe';
    verdict = `${Math.max(aAhead, bAhead)} of the ${count(metrics.length, 'difference')} favour ${winner}.`;
  }

  return {
    name: pair.a.name,
    aBranchId: pair.a.id,
    bBranchId: pair.b.id,
    aEndNodeId: aEnd.id,
    bEndNodeId: bEnd.id,
    aEndTitle: aEnd.title,
    bEndTitle: bEnd.title,
    aEndAtLabel: aEnd.t === 0 ? 'now' : `month ${aEnd.t}`,
    bEndAtLabel: bEnd.t === 0 ? 'now' : `month ${bEnd.t}`,
    metrics,
    sameCount,
    diffCount: metrics.length,
    aAhead,
    bAhead,
    headline,
    verdict,
  };
}

function lineageNoteList(
  kind: UniverseRelationKind,
  aDoc: SimulationDoc,
  bDoc: SimulationDoc
): string[] {
  const out: string[] = [];
  const add = (cf: Counterfactual): void => {
    out.push(`${cf.target}: ${cf.fromValue} → ${cf.toValue}. ${cf.note}`);
  };
  if (kind === 'b-from-a' || kind === 'siblings' || kind === 'related') {
    if (bDoc.counterfactual) add(bDoc.counterfactual);
  }
  if (kind === 'a-from-b' || kind === 'siblings' || kind === 'related') {
    if (aDoc.counterfactual) add(aDoc.counterfactual);
  }
  return out.filter((note, i) => out.indexOf(note) === i);
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(normalise);
  const right = b.map(normalise);
  return left.every((value, i) => value === right[i]);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
