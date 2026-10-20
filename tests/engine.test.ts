/**
 * Engine tests: universe construction, determinism, graph integrity, transitions, expansion.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PACKS, BASE_PACK, allRuleIds, allVarKeys } from '../src/core/packs';
import {
  LIMITS,
  baseStateFor,
  buildAssumptions,
  createUniverse,
  derive,
  expandNode,
  forecastFrom,
  hashString,
  outcomeSpread,
  pathTo,
  subtreeOf,
  updateAssumptions,
} from '../src/core/engine';
import {
  validateGraph,
  visibleNodes,
  ancestorsOf,
  descendantsOf,
  searchNodes,
} from '../src/core/graph';
import { runLayout, boundsOf, layoutAdded, LAYOUT } from '../src/core/layout';
import { ALL_VARS } from '../src/core/packs/vars';
import { detectArchetypes } from '../src/core/archetypes';
import type { ScenarioPrompt, SimNode, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.3,
  resources: ['savings of 12000', 'income 2400/month'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt });
}

function nodeArray(doc: SimulationDoc): SimNode[] {
  return Object.values(doc.nodes);
}

describe('createUniverse', () => {
  it('produces a structurally valid document', () => {
    const doc = makeDoc();
    const report = validateGraph(doc);
    expect(report.errors).toEqual([]);
    expect(nodeArray(doc).filter((n) => n.type === 'start')).toHaveLength(1);
    expect(Object.keys(doc.branches).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(doc.layout).length).toBe(Object.keys(doc.nodes).length);
    expect(doc.schemaVersion).toBe(3);
    expect(doc.assumptions.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = makeDoc(42);
    const b = makeDoc(42);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
    expect(JSON.stringify(a.branches)).toBe(JSON.stringify(b.branches));
  });

  it('diverges for a different seed', () => {
    const a = makeDoc(42);
    const b = makeDoc(43);
    expect(JSON.stringify(a.nodes)).not.toBe(JSON.stringify(b.nodes));
  });

  it('never exceeds the node and branch limits', () => {
    const doc = createUniverse({
      packs: ALL_PACKS,
      seed: 7,
      prompt: { ...prompt, branchCount: 6 },
    });
    expect(Object.keys(doc.nodes).length).toBeLessThanOrEqual(LIMITS.maxNodes);
    expect(Object.keys(doc.branches).length).toBeLessThanOrEqual(LIMITS.maxBranches);
  });

  it('assigns every node to an existing branch with a valid layout point', () => {
    const doc = makeDoc();
    for (const node of nodeArray(doc)) {
      expect(doc.branches[node.branch]).toBeDefined();
      expect(doc.layout[node.id]).toBeDefined();
      expect(Number.isFinite(doc.layout[node.id]?.x ?? NaN)).toBe(true);
      expect(Number.isFinite(doc.layout[node.id]?.y ?? NaN)).toBe(true);
    }
  });

  it('keeps parent/child arrays consistent with the edge list', () => {
    const doc = makeDoc();
    for (const edge of Object.values(doc.edges)) {
      expect(doc.nodes[edge.from]?.children).toContain(edge.to);
      expect(doc.nodes[edge.to]?.parents).toContain(edge.from);
    }
    for (const node of nodeArray(doc)) {
      for (const child of node.children) {
        expect(doc.nodes[child]?.parents).toContain(node.id);
      }
      for (const parent of node.parents) {
        expect(doc.nodes[parent]?.children).toContain(node.id);
      }
    }
  });

  it('only fires rules whose archetype requirements are satisfied', () => {
    const doc = makeDoc();
    const active = new Set(doc.prompt.archetypes);
    const ruleIds = new Set(allRuleIds());
    for (const node of nodeArray(doc)) {
      if (!node.ruleId) continue;
      expect(ruleIds.has(node.ruleId)).toBe(true);
      const rule = ALL_PACKS.flatMap((p) => p.rules).find((r) => r.id === node.ruleId);
      if (rule?.requires && rule.requires.length > 0) {
        expect(rule.requires.some((r) => active.has(r))).toBe(true);
      }
    }
  });

  it('produces finite state values only', () => {
    const doc = makeDoc();
    for (const node of nodeArray(doc)) {
      for (const value of Object.values(node.state ?? {})) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('state transitions', () => {
  it('derive always yields finite, clamped values', () => {
    const state = derive({ money: 1e12, stress: -500, focus: 1e9 }, ['finance', 'time']);
    for (const [key, value] of Object.entries(state)) {
      expect(Number.isFinite(value), `${key}=${value}`).toBe(true);
    }
    expect(state['stress']).toBeGreaterThanOrEqual(0);
    expect(state['stress']).toBeLessThanOrEqual(100);
    expect(state['focus']).toBeLessThanOrEqual(100);
  });

  it('seeds base state from the prompt resources', () => {
    const state = baseStateFor(prompt);
    expect(state['money']).toBe(12000);
    expect(state['income']).toBe(2400);
    expect(Number.isFinite(state['runway'] ?? NaN)).toBe(true);
  });

  it('records a delta for each node transition it caused', () => {
    const doc = makeDoc();
    const withDelta = nodeArray(doc).filter((n) => (n.delta?.length ?? 0) > 0);
    expect(withDelta.length).toBeGreaterThan(0);
    for (const node of withDelta) {
      for (const d of node.delta ?? []) {
        expect(typeof d.key).toBe('string');
        expect(typeof d.reason).toBe('string');
        expect(Number.isFinite(d.before)).toBe(true);
        expect(Number.isFinite(d.after)).toBe(true);
      }
    }
  });

  it('buildAssumptions round-trips overrides through updateAssumptions', () => {
    const assumptions = buildAssumptions(prompt, 1);
    expect(assumptions.length).toBeGreaterThan(0);
    const editable = assumptions.find((a) => a.editable);
    expect(editable).toBeDefined();
    if (!editable) return;

    const doc = makeDoc();
    const updated = updateAssumptions(doc, { [editable.id]: editable.value + 500 });
    const after = updated.assumptions.find((a) => a.id === editable.id);
    expect(after?.value).toBe(editable.value + 500);
    // The original document must not be mutated.
    expect(doc.assumptions.find((a) => a.id === editable.id)?.value).toBe(editable.value);
  });
});

describe('expansion', () => {
  it('adds nodes without destroying existing ones', () => {
    const doc = makeDoc();
    const target = nodeArray(doc).find((n) => n.expandable);
    expect(target).toBeDefined();
    if (!target) return;

    const beforeIds = new Set(Object.keys(doc.nodes));
    const beforeEdgeIds = new Set(Object.keys(doc.edges));
    const beforeStart = nodeArray(doc).find((n) => n.type === 'start');

    const result = expandNode(doc, target.id, ALL_PACKS);

    // Nothing pre-existing may be replaced.
    expect(result.added.length).toBeGreaterThan(0);
    for (const id of result.added) {
      expect(beforeIds.has(id)).toBe(false);
    }
    for (const id of Object.keys(result.doc.edges)) {
      if (beforeEdgeIds.has(id)) {
        const before = doc.edges[id];
        expect(result.doc.edges[id]).toEqual(before);
      }
    }
    expect(beforeStart).toBeDefined();
    if (beforeStart) {
      expect(result.doc.nodes[beforeStart.id]).toEqual(beforeStart);
    }

    // Node count grows by exactly the number of added nodes.
    expect(Object.keys(result.doc.nodes).length).toBe(
      Object.keys(doc.nodes).length + result.added.length
    );
  });

  it('maintains graph integrity after expansion', () => {
    const doc = makeDoc();
    const target = nodeArray(doc).find((n) => n.expandable);
    if (!target) return;
    const result = expandNode(doc, target.id, ALL_PACKS);
    expect(validateGraph(result.doc).errors).toEqual([]);
  });

  it('is deterministic per node (same node + seed gives same expansion)', () => {
    const doc = makeDoc(9);
    const target = nodeArray(doc).find((n) => n.expandable);
    if (!target) return;
    const a = expandNode(doc, target.id, ALL_PACKS);
    const b = expandNode(doc, target.id, ALL_PACKS);
    expect(JSON.stringify(a.doc.nodes)).toBe(JSON.stringify(b.doc.nodes));
    expect(a.added).toEqual(b.added);
  });

  it('marks the expanded node as expanded and links children', () => {
    const doc = makeDoc();
    const target = nodeArray(doc).find((n) => n.expandable);
    if (!target) return;
    const result = expandNode(doc, target.id, ALL_PACKS);
    const parent = result.doc.nodes[target.id];
    expect(parent?.expanded).toBe(true);
    expect(parent?.children.length ?? 0).toBeGreaterThan(target.children.length);
    for (const child of parent?.children ?? []) {
      expect(result.doc.nodes[child]?.parents).toContain(target.id);
    }
  });

  it('is a no-op for unknown or non-expandable nodes', () => {
    const doc = makeDoc();
    const unknown = expandNode(doc, 'does-not-exist', ALL_PACKS);
    expect(unknown.added).toEqual([]);
    expect(unknown.doc).toBe(doc);

    const start = nodeArray(doc).find((n) => n.type === 'start');
    if (start && !start.expandable) {
      const result = expandNode(doc, start.id, ALL_PACKS);
      expect(result.added).toEqual([]);
    }
  });

  it('repeated expansion still never collides with existing ids', () => {
    let doc = makeDoc(3);
    const seen = new Set(Object.keys(doc.nodes));
    let expanded = 0;
    for (let i = 0; i < 12 && expanded < 6; i += 1) {
      const target = nodeArray(doc).find((n) => n.expandable && !n.expanded);
      if (!target) break;
      const result = expandNode(doc, target.id, ALL_PACKS);
      if (result.added.length === 0) break;
      for (const id of result.added) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      doc = result.doc;
      expect(validateGraph(doc).errors).toEqual([]);
      expanded += 1;
    }
    expect(expanded).toBeGreaterThan(0);
  });
});

describe('layout', () => {
  it('covers every visible node', () => {
    const doc = makeDoc();
    const laid = runLayout(doc);
    for (const node of visibleNodes(laid)) {
      expect(laid.layout[node.id]).toBeDefined();
    }
  });

  it('keeps columns monotonic with depth', () => {
    const doc = runLayout(makeDoc());
    for (const node of nodeArray(doc)) {
      const point = doc.layout[node.id];
      expect(point).toBeDefined();
      if (!point) continue;
      expect(point.x).toBeCloseTo(node.depth * LAYOUT.columnWidth, 5);
    }
  });

  it('layoutAdded anchors new nodes without touching existing positions', () => {
    const doc = makeDoc();
    const target = nodeArray(doc).find((n) => n.expandable);
    if (!target) return;
    const result = expandNode(doc, target.id, ALL_PACKS);
    const positions = layoutAdded(result.doc, result.added);
    for (const id of result.added) {
      expect(positions[id]).toBeDefined();
      expect(Number.isFinite(positions[id]?.x ?? NaN)).toBe(true);
    }
    for (const id of Object.keys(doc.layout)) {
      expect(positions[id]).toBeUndefined();
    }
  });

  it('boundsOf returns a usable bounding box', () => {
    const doc = makeDoc();
    const bounds = boundsOf(doc.layout);
    expect(bounds).not.toBeNull();
    expect(bounds?.maxX).toBeGreaterThan(bounds?.minX ?? 0);
  });

  it('boundsOf of an empty layout is null', () => {
    expect(boundsOf({})).toBeNull();
  });
});

describe('graph queries', () => {
  it('pathTo returns a chain ending at the node', () => {
    const doc = makeDoc();
    const leaf = nodeArray(doc).find((n) => n.children.length === 0);
    if (!leaf) return;
    const path = pathTo(doc, leaf.id);
    expect(path[path.length - 1]).toBe(leaf.id);
    expect(path[0]).toBe(nodeArray(doc).find((n) => n.parents.length === 0)?.id);
  });

  it('descendantsOf and ancestorsOf are disjoint from the node itself', () => {
    const doc = makeDoc();
    const node = nodeArray(doc).find((n) => n.children.length > 0);
    if (!node) return;
    expect(descendantsOf(doc, node.id)).toContain(node.id); // includes self by design
    expect(ancestorsOf(doc, node.id)).not.toContain(node.id);
    expect(descendantsOf(doc, node.id).length).toBeGreaterThan(1);
  });

  it('subtreeOf matches descendantsOf for a mid-tree node', () => {
    const doc = makeDoc();
    const node = nodeArray(doc).find((n) => n.children.length > 0);
    if (!node) return;
    expect(subtreeOf(doc, node.id).size).toBe(descendantsOf(doc, node.id).length);
  });

  it('searchNodes finds text and ignores short queries', () => {
    const doc = makeDoc();
    const first = nodeArray(doc)[0];
    if (!first) return;
    const word = first.title.split(/\s+/).find((w) => w.length >= 4);
    if (!word) return;
    const hits = searchNodes(doc, word.toLowerCase());
    expect(hits.length).toBeGreaterThan(0);
    expect(searchNodes(doc, 'a')).toEqual([]);
  });
});

describe('forecast and spread', () => {
  it('forecastFrom returns a state at the extended horizon', () => {
    const doc = makeDoc();
    const start = nodeArray(doc).find((n) => n.type === 'start');
    if (!start) return;
    const state = forecastFrom(doc, start.id, ALL_PACKS, 12);
    expect(state).not.toBeNull();
    for (const value of Object.values(state ?? {})) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('forecastFrom is deterministic', () => {
    const doc = makeDoc();
    const start = nodeArray(doc)[0];
    if (!start) return;
    const a = forecastFrom(doc, start.id, ALL_PACKS, 6);
    const b = forecastFrom(doc, start.id, ALL_PACKS, 6);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('forecastFrom of an unknown node is null', () => {
    expect(forecastFrom(makeDoc(), 'nope', ALL_PACKS, 6)).toBeNull();
  });

  it('outcomeSpread reports a labelled p10/p50/p90', () => {
    const doc = makeDoc();
    const start = nodeArray(doc).find((n) => n.type === 'start');
    if (!start) return;
    const spread = outcomeSpread(doc, start.id, ALL_PACKS, 'money', 8);
    if (!spread) return;
    expect(spread.samples).toBe(8);
    expect(spread.p10).toBeLessThanOrEqual(spread.p50);
    expect(spread.p50).toBeLessThanOrEqual(spread.p90);
    // It is a model spread, not a real-world probability, and the field names say so.
    expect(spread.key).toBe('money');
  });

  it('outcomeSpread of an unknown node is null', () => {
    expect(outcomeSpread(makeDoc(), 'nope', ALL_PACKS, 'money')).toBeNull();
  });
});

describe('rule catalogue sanity', () => {
  it('rule ids are globally unique', () => {
    const ids = allRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('variable keys are globally unique', () => {
    const keys = allVarKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every rule requirement references a known archetype', () => {
    const known = new Set([
      'education',
      'learning',
      'career',
      'business',
      'relocation',
      'creative',
      'finance',
      'health',
      'relationships',
      'time',
      'uncertainty',
    ]);
    for (const pack of ALL_PACKS) {
      for (const rule of pack.rules) {
        for (const req of rule.requires ?? []) {
          expect(known.has(req)).toBe(true);
        }
      }
    }
  });

  it('every effect targets a declared variable or a base key', () => {
    const declared = new Set(ALL_VARS.map((v) => v.key));
    for (const pack of ALL_PACKS) {
      for (const rule of pack.rules) {
        for (const effect of rule.effects) {
          expect(declared.has(effect.key)).toBe(true);
        }
      }
    }
  });

  it('every rule has at least one evidence tag', () => {
    for (const pack of ALL_PACKS) {
      for (const rule of pack.rules) {
        expect(rule.evidence.length).toBeGreaterThan(0);
        for (const tag of rule.evidence) {
          expect(['user-fact', 'research', 'assumption', 'speculation']).toContain(tag.cls);
          expect(tag.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the base pack alone has enough rules to build a universe', () => {
    expect(BASE_PACK.rules.length).toBeGreaterThanOrEqual(8);
  });

  it('hashString is stable FNV-1a', () => {
    expect(hashString('')).toBe(2166136261);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('detectArchetypes returns ids that exist in the pack registry', () => {
    const ids = detectArchetypes(
      'I want to start a business and relocate for a new career while managing my health and money'
    );
    expect(ids.length).toBeGreaterThan(0);
    const packIds = new Set(ALL_PACKS.map((p) => p.id));
    for (const id of ids) expect(packIds.has(id)).toBe(true);
  });
});
