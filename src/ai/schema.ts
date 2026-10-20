/**
 * AI response schema: the contract a model must satisfy to contribute to a universe.
 *
 * The model is only ever asked for *bounded structured data* — a few nodes and the edges
 * between them — never for a document. That keeps responses small enough to validate cheaply,
 * makes partial failure recoverable, and means a hallucinated graph cannot corrupt a document
 * that the user already has.
 *
 * All of this runs in the main process; the renderer never sees raw model output.
 */
import type { EvidenceClass, NodeType } from '../core/types';

export interface AiNode {
  /** Local id, unique within the response only. Referenced by edges. */
  ref: string;
  type: NodeType;
  title: string;
  summary: string;
  detail?: string;
  /** Months from now. */
  t: number;
  assumptions: string[];
  uncertainties: string[];
  evidence: { cls: EvidenceClass; text: string; source?: string }[];
  tradeoffs?: { gains: string[]; costs: string[] };
  nextSteps?: string[];
  failurePoints?: string[];
  /** For decision nodes only. */
  decision?: { question: string; options: { id: string; label: string }[] };
  /** Effects applied to the state vector, in the engine's effect vocabulary. */
  effects?: { key: string; op: 'add' | 'set' | 'mul'; value: number; reason: string }[];
}

export interface AiEdge {
  from: string;
  to: string;
  kind: 'causal' | 'choice' | 'alternative' | 'consequence';
  label?: string;
  confidence: 'high' | 'medium' | 'low';
  hypothesis: string;
}

export interface AiBranch {
  ref: string;
  name: string;
  intent: string;
  description: string;
}

export interface AiScenarioResponse {
  /** Schema the model was asked to produce. */
  schema: 'whatif.scenario.v1';
  branchLabel: string;
  nodes: AiNode[];
  edges: AiEdge[];
  /** Optional additional branches the model proposes. */
  branches?: AiBranch[];
  /** Stated assumptions that apply to the whole response. */
  globalAssumptions?: string[];
  /** Anything the model judges it cannot know. */
  unknowns?: string[];
}

export const AI_LIMITS = {
  maxNodes: 26,
  maxEdges: 40,
  maxBranches: 6,
  maxTitle: 200,
  maxSummary: 2000,
  maxDetail: 4000,
  maxArrayItems: 12,
  maxString: 800,
  maxResponseChars: 400_000,
} as const;

export interface AiValidationIssue {
  path: string;
  message: string;
  /** Fatal issues make the whole response unusable; others cause the offending item to be dropped. */
  fatal: boolean;
}

export interface AiParseResult {
  ok: boolean;
  data?: AiScenarioResponse;
  issues: AiValidationIssue[];
  /** Items dropped for being malformed, for reporting back to the user. */
  dropped: number;
}

const NODE_TYPES: ReadonlySet<string> = new Set([
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

const EDGE_KINDS: ReadonlySet<string> = new Set(['causal', 'choice', 'alternative', 'consequence']);
const EVIDENCE: ReadonlySet<string> = new Set([
  'user-fact',
  'research',
  'assumption',
  'speculation',
]);
const EFFECT_OPS: ReadonlySet<string> = new Set(['add', 'set', 'mul']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function trim(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function stringList(v: unknown, maxItems = AI_LIMITS.maxArrayItems): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v.slice(0, maxItems)) {
    const s = trim(item, AI_LIMITS.maxString);
    if (s) out.push(s);
  }
  return out;
}

function numberish(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Strips the common ways a model wraps JSON: ```json fences, a leading "Here is the JSON:"
 * sentence, or a BOM. Models produce these often enough that failing on them would make the
 * feature unreliable.
 */
export function extractJson(raw: string): string | null {
  let text = raw.replace(/^\uFEFF/, '').trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) text = fence[1].trim();

  if (text.startsWith('{')) return text;

  // Fall back to the outermost balanced object.
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses and structurally validates a model response.
 *
 * Never throws. Invalid items are dropped with a recorded issue rather than rejecting the whole
 * response, because a model that produced 9 good nodes and 1 broken one has still produced
 * something useful.
 */
export function parseScenarioResponse(raw: string): AiParseResult {
  const issues: AiValidationIssue[] = [];
  let dropped = 0;

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      issues: [{ path: '', message: 'The provider returned an empty response.', fatal: true }],
      dropped: 0,
    };
  }
  if (raw.length > AI_LIMITS.maxResponseChars) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: `Response was ${raw.length} characters, exceeding the limit of ${AI_LIMITS.maxResponseChars}.`,
          fatal: true,
        },
      ],
      dropped: 0,
    };
  }

  const json = extractJson(raw);
  if (!json) {
    return {
      ok: false,
      issues: [
        { path: '', message: 'No JSON object could be found in the response.', fatal: true },
      ],
      dropped: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return {
      ok: false,
      issues: [{ path: '', message: `The response was not valid JSON: ${message}`, fatal: true }],
      dropped: 0,
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'The response was not a JSON object.', fatal: true }],
      dropped: 0,
    };
  }

  const rawNodes = Array.isArray(parsed['nodes']) ? parsed['nodes'] : [];
  if (rawNodes.length === 0) {
    return {
      ok: false,
      issues: [{ path: 'nodes', message: 'The response contained no nodes.', fatal: true }],
      dropped: 0,
    };
  }
  if (rawNodes.length > AI_LIMITS.maxNodes) {
    issues.push({
      path: 'nodes',
      message: `Response contained ${rawNodes.length} nodes; only the first ${AI_LIMITS.maxNodes} were used.`,
      fatal: false,
    });
  }

  const nodes: AiNode[] = [];
  const seenRefs = new Set<string>();

  for (let i = 0; i < Math.min(rawNodes.length, AI_LIMITS.maxNodes); i += 1) {
    const rawNode = rawNodes[i];
    const path = `nodes[${i}]`;
    if (!isObject(rawNode)) {
      issues.push({ path, message: 'Node is not an object.', fatal: false });
      dropped += 1;
      continue;
    }

    const ref = trim(rawNode['ref'], 64);
    const title = trim(rawNode['title'], AI_LIMITS.maxTitle);
    const summary = trim(rawNode['summary'], AI_LIMITS.maxSummary);

    if (!ref || !title) {
      issues.push({ path, message: 'Node is missing a "ref" or "title".', fatal: false });
      dropped += 1;
      continue;
    }
    if (seenRefs.has(ref)) {
      issues.push({
        path: `${path}.ref`,
        message: `Duplicate node reference "${ref}" was dropped.`,
        fatal: false,
      });
      dropped += 1;
      continue;
    }
    seenRefs.add(ref);

    const typeRaw = trim(rawNode['type'], 32);
    if (!NODE_TYPES.has(typeRaw)) {
      issues.push({
        path: `${path}.type`,
        message: `Unknown node type "${typeRaw}"; treated as "event".`,
        fatal: false,
      });
    }

    const evidence: AiNode['evidence'] = [];
    if (Array.isArray(rawNode['evidence'])) {
      for (const item of rawNode['evidence'].slice(0, 8)) {
        if (!isObject(item)) continue;
        const text = trim(item['text'], AI_LIMITS.maxString);
        if (!text) continue;
        const cls = trim(item['cls'], 32);
        evidence.push({
          cls: EVIDENCE.has(cls) ? (cls as EvidenceClass) : 'assumption',
          text,
          ...(typeof item['source'] === 'string' && item['source'].trim()
            ? { source: trim(item['source'], 300) }
            : {}),
        });
      }
    }
    if (evidence.length === 0) {
      evidence.push({
        cls: 'speculation',
        text: 'The provider did not classify this statement. Treat it as speculative.',
      });
    }

    const node: AiNode = {
      ref,
      type: NODE_TYPES.has(typeRaw) ? (typeRaw as NodeType) : 'event',
      title,
      summary: summary || 'The provider did not supply a summary for this step.',
      t: Math.max(0, numberish(rawNode['t']) ?? 0),
      assumptions: stringList(rawNode['assumptions']),
      uncertainties: stringList(rawNode['uncertainties']),
      evidence,
    };

    const detail = trim(rawNode['detail'], AI_LIMITS.maxDetail);
    if (detail) node.detail = detail;

    if (isObject(rawNode['tradeoffs'])) {
      const gains = stringList(rawNode['tradeoffs']['gains']);
      const costs = stringList(rawNode['tradeoffs']['costs']);
      if (gains.length > 0 || costs.length > 0) node.tradeoffs = { gains, costs };
    }

    const nextSteps = stringList(rawNode['nextSteps']);
    if (nextSteps.length > 0) node.nextSteps = nextSteps;
    const failurePoints = stringList(rawNode['failurePoints']);
    if (failurePoints.length > 0) node.failurePoints = failurePoints;

    if (isObject(rawNode['decision'])) {
      const question = trim(rawNode['decision']['question'], 500);
      const options = Array.isArray(rawNode['decision']['options'])
        ? rawNode['decision']['options']
            .slice(0, 6)
            .filter(isObject)
            .map((o, idx) => ({
              id: trim(o['id'], 64) || `opt${idx}`,
              label: trim(o['label'], 200),
            }))
            .filter((o) => o.label.length > 0)
        : [];
      if (question) node.decision = { question, options };
    }

    if (Array.isArray(rawNode['effects'])) {
      const effects: AiNode['effects'] = [];
      for (const item of rawNode['effects'].slice(0, 10)) {
        if (!isObject(item)) continue;
        const key = trim(item['key'], 80);
        const op = trim(item['op'], 8);
        const value = numberish(item['value']);
        const reason = trim(item['reason'], 240);
        if (!key || value === null || !reason) {
          issues.push({
            path: `${path}.effects`,
            message: 'An effect was missing a key, value or reason and was dropped.',
            fatal: false,
          });
          continue;
        }
        if (!EFFECT_OPS.has(op)) {
          issues.push({
            path: `${path}.effects.op`,
            message: `Unknown effect operation "${op}" was dropped.`,
            fatal: false,
          });
          continue;
        }
        effects.push({ key, op: op as 'add' | 'set' | 'mul', value, reason });
      }
      if (effects.length > 0) node.effects = effects;
    }

    nodes.push(node);
  }

  if (nodes.length === 0) {
    return {
      ok: false,
      issues: [
        ...issues,
        { path: 'nodes', message: 'No usable nodes remained after validation.', fatal: true },
      ],
      dropped,
    };
  }

  // --- Edges: must reference surviving nodes, and must not duplicate each other.
  const edges: AiEdge[] = [];
  const edgeKeys = new Set<string>();
  const rawEdges = Array.isArray(parsed['edges']) ? parsed['edges'] : [];
  const validRefs = new Set(nodes.map((n) => n.ref));

  for (let i = 0; i < Math.min(rawEdges.length, AI_LIMITS.maxEdges); i += 1) {
    const rawEdge = rawEdges[i];
    const path = `edges[${i}]`;
    if (!isObject(rawEdge)) {
      dropped += 1;
      continue;
    }
    const from = trim(rawEdge['from'], 64);
    const to = trim(rawEdge['to'], 64);

    if (!validRefs.has(from) || !validRefs.has(to)) {
      issues.push({
        path,
        message: `Edge "${from}" -> "${to}" referenced a node that does not exist and was dropped.`,
        fatal: false,
      });
      dropped += 1;
      continue;
    }
    if (from === to) {
      issues.push({
        path,
        message: `Edge "${from}" -> "${to}" is a self-loop and was dropped.`,
        fatal: false,
      });
      dropped += 1;
      continue;
    }
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) {
      issues.push({ path, message: `Duplicate edge "${key}" was dropped.`, fatal: false });
      dropped += 1;
      continue;
    }
    edgeKeys.add(key);

    const kind = trim(rawEdge['kind'], 32);
    const confidence = trim(rawEdge['confidence'], 16);
    edges.push({
      from,
      to,
      kind: EDGE_KINDS.has(kind) ? (kind as AiEdge['kind']) : 'causal',
      confidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium',
      hypothesis:
        trim(rawEdge['hypothesis'], 600) || 'The model treats this as a plausible transition.',
    });
  }

  if (edges.length === 0 && nodes.length > 1) {
    issues.push({
      path: 'edges',
      message: 'No usable edges were returned, so the nodes cannot be connected into a timeline.',
      fatal: true,
    });
    return { ok: false, issues, dropped };
  }

  const branches: AiBranch[] = [];
  if (Array.isArray(parsed['branches'])) {
    for (const item of parsed['branches'].slice(0, AI_LIMITS.maxBranches)) {
      if (!isObject(item)) continue;
      const ref = trim(item['ref'], 64);
      const name = trim(item['name'], 200);
      if (!ref || !name) continue;
      branches.push({
        ref,
        name,
        intent: trim(item['intent'], 500),
        description: trim(item['description'], 800),
      });
    }
  }

  const data: AiScenarioResponse = {
    schema: 'whatif.scenario.v1',
    branchLabel: trim(parsed['branchLabel'], 200) || 'Model-generated path',
    nodes,
    edges,
    globalAssumptions: stringList(parsed['globalAssumptions']),
    unknowns: stringList(parsed['unknowns']),
  };
  if (branches.length > 0) data.branches = branches;

  return { ok: true, data, issues, dropped };
}

/**
 * The JSON contract sent to a model. Kept in one place so the prompt and the validator cannot
 * drift apart.
 */
export const RESPONSE_SCHEMA_SPEC = `Respond with a single JSON object and nothing else. Schema:

{
  "schema": "whatif.scenario.v1",
  "branchLabel": string,
  "globalAssumptions": string[],
  "unknowns": string[],
  "nodes": [
    {
      "ref": string,                       // short unique id, e.g. "n1"
      "type": "decision"|"event"|"opportunity"|"setback"|"milestone"|"consequence"|"ending",
      "title": string,                     // <= 90 characters
      "summary": string,                    // 2-4 sentences explaining the mechanism
      "detail": string,                     // optional, longer explanation
      "t": number,                          // months from now
      "assumptions": string[],
      "uncertainties": string[],
      "evidence": [{"cls":"user-fact"|"research"|"assumption"|"speculation","text":string,"source":string?}],
      "tradeoffs": {"gains": string[], "costs": string[]},
      "nextSteps": string[],
      "failurePoints": string[],
      "decision": {"question": string, "options": [{"id":string,"label":string}]},
      "effects": [{"key":string,"op":"add"|"set"|"mul","value":number,"reason":string}]
    }
  ],
  "edges": [
    {
      "from": string, "to": string,
      "kind": "causal"|"choice"|"alternative"|"consequence",
      "label": string?,
      "confidence": "high"|"medium"|"low",
      "hypothesis": string
    }
  ]
}

Rules: every "from"/"to" must reference a declared "ref". At most 24 nodes and 40 edges. "t" must increase along a path. Never state probabilities of real-world outcomes. Never claim to know the person's actual future.`;
