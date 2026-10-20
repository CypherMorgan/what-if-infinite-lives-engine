/**
 * Import-time schema validation.
 *
 * Nothing from outside the application — an imported file, a cloud model response — reaches the
 * store without passing through here. Validation is deliberately *strict about structure and
 * lenient about content*: a missing `summary` is an error, an unusually wordy `summary` is
 * truncated rather than rejected.
 */
import { SCHEMA_VERSION, type SimEdge, type SimNode, type SimulationDoc } from './types';
import { ALL_VARS } from './packs/vars';
import { MAX_EDGES, MAX_NODES } from './graph';

export interface ValidationIssue {
  path: string;
  message: string;
  fatal: boolean;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** The normalised document, present when `ok` is true. */
  doc?: SimulationDoc;
}

const NODE_TYPES = new Set([
  'start',
  'decision',
  'event',
  'opportunity',
  'setback',
  'milestone',
  'consequence',
  'alternative',
  'ending',
]);

const EDGE_KINDS = new Set(['causal', 'choice', 'alternative', 'consequence']);
const EVIDENCE_CLASSES = new Set(['user-fact', 'research', 'assumption', 'speculation']);
const VAR_UNITS = new Set(['currency', 'months', 'percent', 'count', 'level', 'index']);

/** Hard caps that stop a hostile or corrupt file from exhausting memory. */
export const IMPORT_LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxStringLength: 20_000,
  maxArrayLength: 400,
} as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') {
    return v.length > IMPORT_LIMITS.maxStringLength ? v.slice(0, IMPORT_LIMITS.maxStringLength) : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number.parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function strArray(v: unknown, max: number = IMPORT_LIMITS.maxArrayLength): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, max)
    .map((x) => str(x))
    .filter((s) => s.trim().length > 0);
}

function normalizeState(v: unknown): Record<string, number> {
  if (!isObject(v)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v)) {
    const n = num(value, Number.NaN);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function normalizeEvidence(v: unknown): SimNode['evidence'] {
  if (!Array.isArray(v)) return [];
  const out: SimNode['evidence'] = [];
  for (const item of v.slice(0, 40)) {
    if (!isObject(item)) continue;
    const cls = str(item['cls']);
    const text = str(item['text']);
    if (!text) continue;
    out.push({
      cls: EVIDENCE_CLASSES.has(cls) ? (cls as SimNode['evidence'][number]['cls']) : 'assumption',
      text,
      ...(typeof item['source'] === 'string' ? { source: item['source'] } : {}),
    });
  }
  return out;
}

function normalizeNode(id: string, raw: unknown, issues: ValidationIssue[]): SimNode | null {
  if (!isObject(raw)) {
    issues.push({ path: `nodes.${id}`, message: 'Not an object.', fatal: false });
    return null;
  }

  const type = str(raw['type']);
  if (!NODE_TYPES.has(type)) {
    issues.push({
      path: `nodes.${id}.type`,
      message: `Unknown node type "${type}".`,
      fatal: false,
    });
  }
  const title = str(raw['title']).trim();
  if (!title) {
    issues.push({ path: `nodes.${id}.title`, message: 'Missing title.', fatal: false });
    return null;
  }

  const node: SimNode = {
    id,
    type: NODE_TYPES.has(type) ? (type as SimNode['type']) : 'event',
    title: title.slice(0, 240),
    summary: str(raw['summary']).slice(0, 4000),
    t: Math.max(0, num(raw['t'], 0)),
    horizon: str(raw['horizon'], `month ${Math.round(num(raw['t'], 0))}`).slice(0, 120),
    branch: str(raw['branch'], 'b0'),
    depth: Math.max(0, Math.round(num(raw['depth'], 0))),
    parents: strArray(raw['parents']),
    children: strArray(raw['children']),
    assumptions: strArray(raw['assumptions'], 40),
    uncertainties: strArray(raw['uncertainties'], 40),
    evidence: normalizeEvidence(raw['evidence']),
    expandable: raw['expandable'] === true,
    expanded: raw['expanded'] === true,
  };

  const detail = str(raw['detail']).trim();
  if (detail) node.detail = detail.slice(0, 8000);

  if (isObject(raw['state'])) node.state = normalizeState(raw['state']);

  if (Array.isArray(raw['delta'])) {
    node.delta = raw['delta']
      .slice(0, 60)
      .filter(isObject)
      .map((d) => ({
        key: str(d['key']),
        before: num(d['before']),
        after: num(d['after']),
        reason: str(d['reason']).slice(0, 240),
      }))
      .filter((d) => d.key.length > 0);
  }

  if (isObject(raw['tradeoffs'])) {
    const gains = strArray(raw['tradeoffs']['gains'], 20);
    const costs = strArray(raw['tradeoffs']['costs'], 20);
    if (gains.length > 0 || costs.length > 0) node.tradeoffs = { gains, costs };
  }

  if (isObject(raw['decision'])) {
    const question = str(raw['decision']['question']).trim();
    const options = Array.isArray(raw['decision']['options'])
      ? raw['decision']['options']
          .slice(0, 8)
          .filter(isObject)
          .map((o) => {
            const option: { id: string; label: string; leadsTo?: string } = {
              id: str(o['id']),
              label: str(o['label']),
            };
            const leadsTo = str(o['leadsTo']).trim();
            if (leadsTo) option.leadsTo = leadsTo;
            return option;
          })
          .filter((o) => o.label.length > 0)
      : [];
    if (question) node.decision = { question: question.slice(0, 500), options };
  }

  const nextSteps = strArray(raw['nextSteps'], 20);
  if (nextSteps.length > 0) node.nextSteps = nextSteps;
  const failurePoints = strArray(raw['failurePoints'], 20);
  if (failurePoints.length > 0) node.failurePoints = failurePoints;
  const resources = strArray(raw['resources'], 20);
  if (resources.length > 0) node.resources = resources;

  const ruleId = str(raw['ruleId']).trim();
  if (ruleId) node.ruleId = ruleId;
  const userNotes = str(raw['userNotes']);
  if (userNotes) node.userNotes = userNotes;

  return node;
}

function normalizeEdge(id: string, raw: unknown): SimEdge | null {
  if (!isObject(raw)) return null;
  const from = str(raw['from']);
  const to = str(raw['to']);
  if (!from || !to) return null;
  const kind = str(raw['kind']);
  const confidence = str(raw['confidence']);
  const edge: SimEdge = {
    id,
    from,
    to,
    kind: EDGE_KINDS.has(kind) ? (kind as SimEdge['kind']) : 'causal',
    confidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium',
    hypothesis: str(raw['hypothesis'], 'The model treats this as a plausible transition.').slice(
      0,
      600
    ),
  };
  const label = str(raw['label']).trim();
  if (label) edge.label = label.slice(0, 240);
  return edge;
}

/**
 * Validates and normalises an arbitrary value as a simulation document.
 * Returns a fully-formed document on success; the caller must not use the input afterwards.
 */
export function validateDocument(input: unknown): ValidationResult {
  void SCHEMA_VERSION;
  const issues: ValidationIssue[] = [];

  if (!isObject(input)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'The file does not contain a JSON object.', fatal: true }],
    };
  }

  const id = str(input['id']).trim();
  if (!id) issues.push({ path: 'id', message: 'Missing document id.', fatal: true });

  const rawNodes = input['nodes'];
  if (!isObject(rawNodes)) {
    issues.push({ path: 'nodes', message: 'Missing or invalid "nodes" object.', fatal: true });
  }
  const rawEdges = input['edges'];
  if (!isObject(rawEdges)) {
    issues.push({ path: 'edges', message: 'Missing or invalid "edges" object.', fatal: true });
  }

  if (issues.some((i) => i.fatal)) return { ok: false, issues };

  const nodeEntries = Object.entries(rawNodes as Record<string, unknown>);
  const edgeEntries = Object.entries(rawEdges as Record<string, unknown>);

  if (nodeEntries.length > MAX_NODES) {
    return {
      ok: false,
      issues: [
        {
          path: 'nodes',
          message: `Contains ${nodeEntries.length} nodes, exceeding the limit of ${MAX_NODES}.`,
          fatal: true,
        },
      ],
    };
  }
  if (edgeEntries.length > MAX_EDGES) {
    return {
      ok: false,
      issues: [
        {
          path: 'edges',
          message: `Contains ${edgeEntries.length} edges, exceeding the limit of ${MAX_EDGES}.`,
          fatal: true,
        },
      ],
    };
  }

  const nodes: Record<string, SimNode> = {};
  for (const [key, raw] of nodeEntries) {
    const node = normalizeNode(key, raw, issues);
    if (node) nodes[key] = node;
  }

  const edges: Record<string, SimEdge> = {};
  for (const [key, raw] of edgeEntries) {
    const edge = normalizeEdge(key, raw);
    if (edge) edges[key] = edge;
  }

  const branches: SimulationDoc['branches'] = {};
  if (isObject(input['branches'])) {
    for (const [key, raw] of Object.entries(input['branches'])) {
      if (!isObject(raw)) continue;
      const name = str(raw['name']).trim();
      if (!name) continue;
      branches[key] = {
        id: key,
        name: name.slice(0, 200),
        hue: Math.min(Math.max(num(raw['hue'], 0), 0), 360),
        root: str(raw['root'], 'n1'),
        description: str(raw['description']).slice(0, 600),
      };
    }
  }

  if (Object.keys(branches).length === 0) {
    issues.push({
      path: 'branches',
      message: 'No valid branches found; derived from nodes instead.',
      fatal: false,
    });
    for (const node of Object.values(nodes)) {
      if (!branches[node.branch]) {
        branches[node.branch] = {
          id: node.branch,
          name: node.branch === 'b0' ? 'Where you are now' : `Branch ${node.branch}`,
          hue: (Object.keys(branches).length * 47) % 360,
          root: node.id,
          description: 'Recovered from the node graph during import.',
        };
      }
    }
  }

  const layout: SimulationDoc['layout'] = {};
  if (isObject(input['layout'])) {
    for (const [key, raw] of Object.entries(input['layout'])) {
      if (!isObject(raw)) continue;
      layout[key] = { x: num(raw['x']), y: num(raw['y']) };
    }
  }

  const vars = Array.isArray(input['vars'])
    ? input['vars']
        .slice(0, 300)
        .filter(isObject)
        .map((v) => ({
          key: str(v['key']),
          label: str(v['label'], str(v['key'])),
          unit: VAR_UNITS.has(str(v['unit']))
            ? (str(v['unit']) as (typeof ALL_VARS)[number]['unit'])
            : 'index',
          kind: str(v['kind'], 'resource') as (typeof ALL_VARS)[number]['kind'],
          direction: (str(v['direction']) === 'down'
            ? 'down'
            : str(v['direction']) === 'neutral'
              ? 'neutral'
              : 'up') as (typeof ALL_VARS)[number]['direction'],
          domain: str(v['domain'], 'personal') as (typeof ALL_VARS)[number]['domain'],
          ...(v['primary'] === true ? { primary: true } : {}),
        }))
        .filter((v) => v.key.length > 0)
    : [];

  const assumptions = Array.isArray(input['assumptions'])
    ? input['assumptions']
        .slice(0, 60)
        .filter(isObject)
        .map((a) => ({
          id: str(a['id']),
          label: str(a['label'], 'Unnamed assumption'),
          varKey: str(a['varKey']),
          unit: VAR_UNITS.has(str(a['unit']))
            ? (str(a['unit']) as (typeof ALL_VARS)[number]['unit'])
            : 'index',
          baseValue: num(a['baseValue']),
          value: num(a['value']),
          rationale: str(a['rationale']),
          sensitivity: Math.min(Math.max(num(a['sensitivity']), 0), 1),
          editable: a['editable'] !== false,
        }))
        .filter((a) => a.id.length > 0)
    : [];

  const rawPrompt = isObject(input['prompt']) ? input['prompt'] : {};
  const prompt: SimulationDoc['prompt'] = {
    situation: str(rawPrompt['situation']),
    decision: str(rawPrompt['decision']),
    goals: strArray(rawPrompt['goals'], 20),
    constraints: strArray(rawPrompt['constraints'], 20),
    horizon: Math.max(1, Math.min(num(rawPrompt['horizon'], 24), 240)),
    branchCount: Math.max(2, Math.min(num(rawPrompt['branchCount'], 4), 6)),
    imagination: Math.min(Math.max(num(rawPrompt['imagination'], 0.2), 0), 1),
    resources: strArray(rawPrompt['resources'], 20),
    archetypes: strArray(rawPrompt['archetypes'], 12),
    title: str(rawPrompt['title'], 'Imported universe'),
  };

  const rawMeta = isObject(input['meta']) ? input['meta'] : {};
  const generator = str(rawMeta['generator']) === 'ai' ? 'ai' : 'offline';

  const startCount = Object.values(nodes).filter((n) => n.type === 'start').length;
  if (startCount !== 1) {
    issues.push({
      path: 'nodes',
      message: `Expected exactly one starting node but found ${startCount}.`,
      fatal: true,
    });
    return { ok: false, issues };
  }

  const doc: SimulationDoc = {
    id,
    schemaVersion: Math.round(num(input['schemaVersion'], 1)),
    createdAt: str(input['createdAt'], new Date().toISOString()),
    updatedAt: str(input['updatedAt'], new Date().toISOString()),
    title: str(input['title'], 'Imported universe').slice(0, 300),
    prompt,
    seed: Math.floor(num(input['seed'], 1)) >>> 0,
    nodes,
    edges,
    branches,
    layout,
    vars,
    assumptions,
    collapsed: strArray(input['collapsed'], 50),
    meta: {
      generator,
      providerLabel: str(rawMeta['providerLabel'], 'Unknown source'),
      provenance: str(rawMeta['provenance'], 'Imported from a file.'),
      ...(typeof rawMeta['modelLabel'] === 'string' ? { modelLabel: rawMeta['modelLabel'] } : {}),
    },
    ...(typeof input['parentId'] === 'string' ? { parentId: input['parentId'] } : {}),
    ...(typeof input['focusNode'] === 'string' ? { focusNode: input['focusNode'] } : {}),
  };

  if (isObject(input['counterfactual'])) {
    const cf = input['counterfactual'];
    doc.counterfactual = {
      target: str(cf['target']),
      fromValue: str(cf['fromValue']),
      toValue: str(cf['toValue']),
      note: str(cf['note']),
      createdAt: str(cf['createdAt'], new Date().toISOString()),
    };
  }

  if (isObject(input['camera'])) {
    doc.camera = {
      x: num(input['camera']['x']),
      y: num(input['camera']['y']),
      scale: Math.min(Math.max(num(input['camera']['scale'], 1), 0.05), 4),
    };
  }

  return { ok: true, issues, doc };
}

/** Quick structural check used before attempting a full import. */
export function looksLikeSimulation(value: unknown): boolean {
  return isObject(value) && isObject(value['nodes']) && isObject(value['edges']);
}
