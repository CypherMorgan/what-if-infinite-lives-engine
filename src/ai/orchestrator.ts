/**
 * The generation orchestrator.
 *
 * Owns the sequence: choose a provider, ask it for structured data, validate the response,
 * and convert it into a real simulation document with computed state. It is the only place
 * that knows how a model response becomes a universe, so the same rules apply whether the
 * response came from a cloud model, a local server or the built-in engine.
 *
 * Runs in the renderer but only ever receives already-validated settings; the network call
 * itself is performed by the provider, which in the desktop shell is executed in the main
 * process via IPC.
 */
import { createUniverse, baseStateFor, derive } from '../core/engine';
import { applyEffects } from '../core/rulePack';
import { ALL_VARS } from '../core/packs/vars';
import { ALL_PACKS } from '../core/packs';
import { runLayout } from '../core/layout';
import { buildAssumptions, hashString } from '../core/engine';
import { detectArchetypes } from '../core/archetypes';
import { type AppError } from '../core/result';
import type {
  Branch,
  BranchId,
  NodeId,
  ScenarioPrompt,
  SimEdge,
  SimNode,
  SimulationDoc,
  StateDelta,
  StateVector,
} from '../core/types';
import { SCHEMA_VERSION } from '../core/types';
import { Rng } from '../core/rng';
import type { AiScenarioResponse } from './schema';
import type {
  GenerationResult,
  GenerationRequest,
  ProviderSettings,
  ScenarioProvider,
} from './provider';
import { offlineProvider } from './offline';
import { createHttpProvider, type HttpProviderDeps } from './http';
import { composeScenario } from './offline';

export interface OrchestratorDeps {
  http?: HttpProviderDeps;
  /** Injected by the desktop shell so HTTP runs in the main process. */
  remoteGenerate?: (
    request: GenerationRequest,
    settings: ProviderSettings
  ) => Promise<GenerationResult>;
}

/** Which provider to use for a given settings object. */
export function selectProvider(
  settings: ProviderSettings,
  deps: OrchestratorDeps = {}
): ScenarioProvider {
  if (
    settings.id === 'openai-compatible' &&
    settings.baseUrl &&
    settings.model &&
    !deps.remoteGenerate
  ) {
    return createHttpProvider(settings, deps.http ?? {});
  }
  if (settings.id === 'openai-compatible' && deps.remoteGenerate) {
    return {
      id: 'openai-compatible',
      label: settings.model ? `${settings.model} via remote` : settings.label,
      available: true,
      generate: (request) => deps.remoteGenerate?.(request, settings) as Promise<GenerationResult>,
    };
  }
  return offlineProvider;
}

/** Converts a validated model response into a full simulation document. */
export function documentFromResponse(
  response: AiScenarioResponse,
  prompt: ScenarioPrompt,
  seed: number,
  id: string,
  meta: SimulationDoc['meta']
): SimulationDoc {
  const archetypes =
    prompt.archetypes.length > 0
      ? prompt.archetypes
      : detectArchetypes(`${prompt.situation} ${prompt.decision}`);
  const effectivePrompt: ScenarioPrompt = { ...prompt, archetypes };

  const nodes: Record<NodeId, SimNode> = {};
  const edges: Record<BranchId, SimEdge> = {};
  const branches: Record<BranchId, Branch> = {};
  const layout: Record<NodeId, { x: number; y: number }> = {};

  // The start node is the first node with no incoming edge; otherwise the first node.
  const incoming = new Set(response.edges.map((e) => e.to));
  const rootNode = response.nodes.find((n) => !incoming.has(n.ref)) ?? response.nodes[0];
  if (!rootNode) {
    // Unreachable: the schema validator guarantees at least one node.
    throw new Error('The provider response contained no usable nodes.');
  }

  // Map model-local refs to stable document ids.
  const idOf = new Map<string, NodeId>();
  response.nodes.forEach((n, index) => {
    idOf.set(n.ref, index === 0 ? 'n0' : `n${index.toString(36)}`);
  });

  const baseState = baseStateFor(effectivePrompt, ALL_VARS);
  const rng = new Rng(seed);
  const states = new Map<NodeId, StateVector>();

  branches['b0'] = {
    id: 'b0',
    name: 'Where you are now',
    hue: 0,
    root: idOf.get(rootNode.ref) ?? 'n0',
    description: 'The state everything else branches from.',
  };

  // Determine branch ownership: a node inherits the branch of its nearest decision ancestor,
  // so each mutually exclusive commitment gets its own visual identity.
  const branchOf = new Map<string, BranchId>();
  let branchCounter = 0;
  for (const node of response.nodes) {
    if (node.ref === rootNode.ref) {
      branchOf.set(node.ref, 'b0');
      continue;
    }
    const parents = response.edges.filter((e) => e.to === node.ref).map((e) => e.from);
    let cursor = parents[0];
    let owner: BranchId = 'b0';
    let guard = 0;
    while (cursor && guard < 30) {
      guard += 1;
      if (branchOf.has(cursor)) {
        owner = branchOf.get(cursor) as BranchId;
        break;
      }
      cursor = response.edges.find((e) => e.to === cursor)?.from;
    }
    branchOf.set(node.ref, owner);
  }

  // Assign a distinct branch to each top-level decision child.
  for (const node of response.nodes) {
    if (node.ref === rootNode.ref) continue;
    if (branchOf.get(node.ref) !== 'b0') continue;
    branchCounter += 1;
    const id: BranchId = `b${branchCounter}`;
    const hue = (branchCounter * 47 + 200) % 360;
    branches[id] = {
      id,
      name: node.title.slice(0, 60),
      hue,
      root: idOf.get(node.ref) ?? 'n0',
      description: node.summary.slice(0, 300),
    };
    branchOf.set(node.ref, id);
    // Propagate to descendants that have not been assigned a deeper branch.
    const stack = [node.ref];
    while (stack.length > 0) {
      const ref = stack.pop() as string;
      for (const edge of response.edges) {
        if (edge.from !== ref) continue;
        if (!branchOf.has(edge.to) || branchOf.get(edge.to) === 'b0') {
          branchOf.set(edge.to, id);
          stack.push(edge.to);
        }
      }
    }
  }

  const ordered = response.nodes.slice().sort((a, b) => a.t - b.t);
  for (const node of ordered) {
    const docId = idOf.get(node.ref);
    if (!docId) continue;

    const effects = (node.effects ?? []).filter((e) => e.op !== undefined);
    const applied =
      effects.length > 0
        ? applyEffects(states.get(docId) ?? baseState, effects, ALL_VARS, rng)
        : { state: states.get(docId) ?? baseState, applied: [] };

    const delta: StateDelta[] = applied.applied.map((a) => ({
      key: a.key,
      before: a.before,
      after: a.after,
      reason: a.reason,
    }));
    states.set(docId, derive(applied.state, archetypes));

    const isRoot = node.ref === rootNode.ref;
    const simNode: SimNode = {
      id: docId,
      // The root of the response is always the document's single starting node, whatever the
      // model chose to call it: validation requires exactly one node of type "start".
      type: isRoot ? 'start' : node.type === 'start' ? 'event' : node.type,
      title: node.title,
      summary: node.summary,
      t: node.t,
      horizon: node.t <= 0 ? 'Now' : `${Math.round(node.t)} months in`,
      branch: branchOf.get(node.ref) ?? 'b0',
      depth: 0,
      parents: [],
      children: [],
      assumptions: [...node.assumptions, ...(response.globalAssumptions ?? [])].slice(0, 8),
      uncertainties: [...node.uncertainties, ...(response.unknowns ?? [])].slice(0, 8),
      evidence: node.evidence,
      expandable: false,
      expanded: false,
      state: states.get(docId),
      delta,
    };
    if (node.detail) simNode.detail = node.detail;
    if (node.tradeoffs) simNode.tradeoffs = node.tradeoffs;
    if (node.nextSteps) simNode.nextSteps = node.nextSteps;
    if (node.failurePoints) simNode.failurePoints = node.failurePoints;
    if (node.decision) simNode.decision = node.decision;

    nodes[docId] = simNode;
  }

  // Connect using the edge list, rebuilding parents/children.
  for (const edge of response.edges) {
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (!from || !to || !nodes[from] || !nodes[to]) continue;
    const id = `e${hashString(`${edge.from}->${edge.to}`).toString(36)}`;
    const simEdge: SimEdge = {
      id,
      from,
      to,
      kind: edge.kind,
      confidence: edge.confidence,
      hypothesis: edge.hypothesis,
    };
    if (edge.label) simEdge.label = edge.label;
    edges[id] = simEdge;

    const fromNode = nodes[from] as SimNode;
    const toNode = nodes[to] as SimNode;
    if (!fromNode.children.includes(to)) fromNode.children.push(to);
    if (!toNode.parents.includes(from)) toNode.parents.push(from);
  }

  // Depth = distance from the start node along the shortest path.
  const startId = idOf.get(rootNode.ref) ?? 'n0';
  const queue: NodeId[] = [startId];
  const seen = new Set<NodeId>([startId]);
  while (queue.length > 0) {
    const id = queue.shift() as NodeId;
    const node = nodes[id];
    if (!node) continue;
    for (const child of node.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      const childNode = nodes[child];
      if (childNode) childNode.depth = node.depth + 1;
      queue.push(child);
    }
  }

  for (const node of Object.values(nodes)) {
    node.expandable =
      node.children.length === 0 && node.depth < 8 && node.t < effectivePrompt.horizon;
  }

  const assumptions = buildAssumptions(effectivePrompt, seed);
  const doc: SimulationDoc = {
    id,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: prompt.title || 'Untitled universe',
    prompt: effectivePrompt,
    seed,
    nodes,
    edges,
    branches,
    layout,
    vars: [...ALL_VARS],
    assumptions,
    collapsed: [],
    meta,
  };

  return runLayout(doc);
}

export interface GenerateOptions {
  prompt: ScenarioPrompt;
  settings: ProviderSettings;
  seed: number;
  id: string;
  deps?: OrchestratorDeps;
  signal?: AbortSignal;
  onProgress?: (note: string) => void;
}

export type GenerateOutcome =
  | { ok: true; doc: SimulationDoc; result: GenerationResult }
  | { ok: false; error: AppError; result?: GenerationResult };

/**
 * Generates a universe, using the configured provider and degrading to the built-in engine
 * whenever the provider cannot deliver. This function never throws for expected failures.
 */
export async function generateUniverse(options: GenerateOptions): Promise<GenerateOutcome> {
  const { prompt, settings, seed, id, deps = {} } = options;
  const provider = selectProvider(settings, deps);
  const effectivePrompt: ScenarioPrompt = {
    ...prompt,
    archetypes:
      prompt.archetypes.length > 0
        ? prompt.archetypes
        : detectArchetypes(`${prompt.situation} ${prompt.decision} ${prompt.goals.join(' ')}`),
  };

  const request: GenerationRequest = {
    kind: 'initial-branches',
    prompt: effectivePrompt,
    vars: [...ALL_VARS],
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };

  let result: GenerationResult;
  try {
    result = await provider.generate(request);
  } catch (e) {
    options.onProgress?.('Provider threw — building the universe locally instead');
    const data = composeScenario(effectivePrompt, ALL_VARS);
    result = {
      ok: true,
      provider: 'offline',
      providerLabel: 'Built-in engine (fallback)',
      data,
      notes: ['The configured provider failed unexpectedly; the built-in engine was used instead.'],
      elapsedMs: 0,
      error: {
        code: 'unexpected',
        message: e instanceof Error ? e.message : 'Unknown provider failure',
      },
    };
  }

  let data = result.data;
  if (!result.ok || !data) {
    // A provider that cannot deliver is not fatal: build from the offline composer, but tell
    // the user clearly what happened so they are not misled about where the content came from.
    options.onProgress?.('Provider unavailable — composing the universe locally');
    data = composeScenario(effectivePrompt, ALL_VARS);
    result = {
      ok: true,
      provider: 'offline',
      providerLabel: 'Built-in engine (fallback)',
      data,
      notes: [
        `The configured provider could not be used: ${result.error?.message ?? 'unknown error'}`,
        'The built-in rules engine produced this universe instead.',
      ],
      elapsedMs: result.elapsedMs,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  const generator = result.provider === 'offline' ? 'offline' : 'ai';
  const doc = documentFromResponse(data, effectivePrompt, seed, id, {
    generator,
    providerLabel: result.providerLabel,
    ...(data.branchLabel ? { modelLabel: data.branchLabel } : {}),
    provenance:
      generator === 'offline'
        ? 'Composed locally by the built-in engine. No data left this machine.'
        : `Generated by ${result.providerLabel}. The scenario text was transmitted to that provider.`,
  });

  return { ok: true, doc, result };
}

/** Convenience for tests: a fully offline universe built straight from the engine. */
export function offlineUniverse(prompt: ScenarioPrompt, seed: number, id: string): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt }, { id });
}
