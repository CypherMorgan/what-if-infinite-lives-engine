/**
 * Store tests.
 *
 * The store is the only place the UI mutates the simulation document, so it
 * carries the undo history, the persistence and the derived helpers. None of
 * that is exercised by the engine tests, which build documents directly.
 *
 * The store is renderer code, so these tests give it the two things a browser
 * would provide — a `localStorage` and a `window` — and then check that the
 * behaviour a person would notice is actually correct.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/* A minimal browser environment                                        */
/* ------------------------------------------------------------------ */

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  get length(): number {
    return this.map.size;
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
});

/* The imports are pulled in after the environment is in place, because the
   store reads `localStorage` while it is being constructed. */
const { Store } = await import('../src/ui/state/store');
const { ALL_PACKS } = await import('../src/core/packs');
const { createUniverse } = await import('../src/core/engine');
type SimulationDoc = import('../src/core/types').SimulationDoc;
type ScenarioPrompt = import('../src/core/types').ScenarioPrompt;

const prompt: ScenarioPrompt = {
  situation: 'I am a support engineer considering a move into software development.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.4,
  resources: ['savings of 12000'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt });
}

function makeStore(seed = 42): InstanceType<typeof Store> {
  return new Store(makeDoc(seed));
}

/**
 * A node that can still be expanded.
 *
 * The starting point arrives with its first steps already laid out, so it is
 * not a candidate — the test has to reach for a step further down.
 */
function expandableNode(store: InstanceType<typeof Store>): string | null {
  const node = Object.values(store.getState().doc.nodes).find((n) => n.expandable && !n.expanded);
  return node?.id ?? null;
}

beforeEach(() => {
  storage.clear();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe('Store — initial state', () => {
  it('starts on the starting point', () => {
    const store = makeStore();
    const state = store.getState();
    const start = Object.values(state.doc.nodes).find((n) => n.type === 'start');
    expect(start).toBeDefined();
    expect(state.selected).toBe(start!.id);
    expect(state.path).toEqual([start!.id]);
  });

  it('does not restore a universe comparison that excludes the open universe', () => {
    storage.setItem('whatifs:view', 'universes');
    storage.setItem('whatifs:universes', JSON.stringify({ a: 'sim_other_a', b: 'sim_other_b' }));
    const store = new Store(makeDoc());
    expect(store.getState().viewMode).toBe('graph');
  });

  it('restores the universe view when the open universe is one side of it', () => {
    const doc = makeDoc();
    storage.setItem('whatifs:view', 'universes');
    storage.setItem('whatifs:universes', JSON.stringify({ a: doc.id, b: 'sim_other' }));
    const store = new Store(doc);
    expect(store.getState().viewMode).toBe('universes');
  });

  it('starts with nothing to undo or redo', () => {
    const store = makeStore();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
    expect(store.getState().undoLabel).toBeNull();
  });

  it('notifies subscribers when the state changes', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setQuery('hello');
    expect(listener).toHaveBeenCalled();
    expect(store.getState().query).toBe('hello');
    unsubscribe();
    store.setQuery('again');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('Store — selection', () => {
  it('records the path to the selected node', () => {
    const store = makeStore();
    const leaf = Object.values(store.getState().doc.nodes).find((n) => n.children.length === 0);
    if (!leaf) return;
    store.select(leaf.id);
    expect(store.getState().selected).toBe(leaf.id);
    expect(store.getState().path[0]).toBe(
      Object.values(store.getState().doc.nodes).find((n) => n.type === 'start')?.id
    );
    expect(store.getState().path.at(-1)).toBe(leaf.id);
  });

  it('clears the selection', () => {
    const store = makeStore();
    store.select(null);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().path).toEqual([]);
  });

  it('centres the camera on a node', () => {
    const store = makeStore();
    const id = Object.keys(store.getState().doc.layout)[0] as string;
    const point = store.getState().doc.layout[id];
    if (!point) return;
    store.centerOn(id);
    expect(store.getState().camera.x).toBeCloseTo(point.x);
    expect(store.getState().camera.y).toBeCloseTo(point.y);
  });

  it('merges partial camera updates', () => {
    const store = makeStore();
    store.setCamera({ scale: 1.75 });
    expect(store.getState().camera.scale).toBe(1.75);
    expect(typeof store.getState().camera.x).toBe('number');
  });
});

describe('Store — expansion', () => {
  it('adds steps and makes the change undoable', () => {
    const store = makeStore();
    const id = expandableNode(store);
    if (!id) return;
    const before = Object.keys(store.getState().doc.nodes).length;
    store.expandNode(id);
    expect(Object.keys(store.getState().doc.nodes).length).toBeGreaterThan(before);
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().undoLabel).toContain('Expand');
  });

  it('refuses to expand a node twice', () => {
    const store = makeStore();
    const id = expandableNode(store);
    if (!id) return;
    store.expandNode(id);
    const count = Object.keys(store.getState().doc.nodes).length;
    store.expandNode(id);
    expect(Object.keys(store.getState().doc.nodes).length).toBe(count);
    expect(store.getState().toasts.some((t) => t.kind === 'info')).toBe(true);
  });

  it('refuses to expand a node that has no further steps', () => {
    const store = makeStore();
    const start = Object.values(store.getState().doc.nodes).find((n) => n.type === 'start');
    if (!start) return;
    const before = Object.keys(store.getState().doc.nodes).length;
    store.expandNode(start.id);
    expect(Object.keys(store.getState().doc.nodes).length).toBe(before);
    expect(store.getState().toasts.length).toBeGreaterThan(0);
  });

  it('does nothing for a node that does not exist', () => {
    const store = makeStore();
    const before = Object.keys(store.getState().doc.nodes).length;
    store.expandNode('nope' as never);
    expect(Object.keys(store.getState().doc.nodes).length).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('Store — history', () => {
  it('undoes and redoes a change', () => {
    const store = makeStore();
    const id = expandableNode(store);
    if (!id) return;
    const before = Object.keys(store.getState().doc.nodes).length;
    store.expandNode(id);
    const after = Object.keys(store.getState().doc.nodes).length;
    expect(after).toBeGreaterThan(before);

    store.undo();
    expect(Object.keys(store.getState().doc.nodes).length).toBe(before);
    expect(store.getState().canRedo).toBe(true);
    expect(store.getState().redoLabel).toContain('Expand');

    store.redo();
    expect(Object.keys(store.getState().doc.nodes).length).toBe(after);
  });

  it('drops the redo stack when a new change is made', () => {
    const store = makeStore();
    const id = expandableNode(store);
    if (!id) return;
    store.expandNode(id);
    store.undo();
    expect(store.getState().canRedo).toBe(true);
    store.setNodeNotes(id, 'a note');
    expect(store.getState().canRedo).toBe(false);
  });

  it('records a note as a history entry', () => {
    const store = makeStore();
    const id = Object.keys(store.getState().doc.nodes)[0] as string;
    store.setNodeNotes(id, 'remember this');
    expect(store.getState().doc.nodes[id]?.userNotes).toBe('remember this');
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(store.getState().doc.nodes[id]?.userNotes).toBeUndefined();
  });
});

describe('Store — branches', () => {
  it('collapses and restores a branch', () => {
    const store = makeStore();
    const branchId = Object.keys(store.getState().doc.branches).find((id) => id !== 'b0');
    if (!branchId) return;
    const visibleBefore = store.visible().size;
    store.toggleBranchCollapse(branchId);
    expect(store.getState().doc.collapsed).toContain(branchId);
    expect(store.visible().size).toBeLessThan(visibleBefore);

    store.toggleBranchCollapse(branchId);
    expect(store.getState().doc.collapsed).not.toContain(branchId);
    expect(store.visible().size).toBe(visibleBefore);
  });
});

describe('Store — assumptions', () => {
  it('previews without recording history', () => {
    const store = makeStore();
    const assumption = store.getState().doc.assumptions.find((a) => a.editable);
    if (!assumption) return;
    store.previewAssumption(assumption.id, assumption.value + 1);
    expect(store.getState().canUndo).toBe(false);
  });

  it('records a committed change in history', () => {
    const store = makeStore();
    const assumption = store.getState().doc.assumptions.find((a) => a.editable);
    if (!assumption) return;
    store.commitAssumption(assumption.id, assumption.value + 1);
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().undoLabel).toContain('Assumption');
  });
});

describe('Store — toasts', () => {
  it('gives every toast a distinct id', () => {
    const store = makeStore();
    store.toast('one');
    store.toast('two');
    const ids = store.getState().toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Store — derived helpers', () => {
  it('builds a dossier for a node and caches it', () => {
    const store = makeStore();
    const id = Object.keys(store.getState().doc.nodes)[0] as string;
    const first = store.dossierFor(id);
    const second = store.dossierFor(id);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('rebuilds the dossier after the document changes', () => {
    const store = makeStore();
    const id = Object.keys(store.getState().doc.nodes)[0] as string;
    const first = store.dossierFor(id);
    store.setNodeNotes(id, 'changed');
    const second = store.dossierFor(id);
    expect(second).not.toBe(first);
  });

  it('explains the path to the selected node', () => {
    const store = makeStore();
    const leaf = Object.values(store.getState().doc.nodes).find((n) => n.children.length === 0);
    if (!leaf) return;
    store.select(leaf.id);
    expect(store.explainPath().length).toBeGreaterThan(0);
  });

  it('compares two nodes', () => {
    const store = makeStore();
    const nodes = Object.values(store.getState().doc.nodes).filter((n) => n.state);
    if (nodes.length < 2) return;
    store.select(nodes[0]!.id);
    store.compareWith(nodes[1]!.id);
    const compare = store.getState().compare;
    expect(compare).not.toBeNull();
    expect(compare!.a.nodeId).toBe(nodes[0]!.id);
    expect(compare!.b.nodeId).toBe(nodes[1]!.id);
  });

  it('refuses to compare a node with itself', () => {
    const store = makeStore();
    const id = Object.keys(store.getState().doc.nodes)[0] as string;
    store.select(id);
    store.compareWith(id);
    expect(store.getState().compare).toBeNull();
  });
});

describe('Store — import and export', () => {
  it('round-trips a universe through text', () => {
    const store = makeStore();
    const text = store.exportText();
    expect(text.length).toBeGreaterThan(0);
    const fresh = makeStore(99);
    expect(fresh.importText(text)).toBe(true);
    expect(Object.keys(fresh.getState().doc.nodes).length).toBe(
      Object.keys(store.getState().doc.nodes).length
    );
  });

  it('rejects text that is not a universe and says so', () => {
    const store = makeStore();
    expect(store.importText('this is not a universe')).toBe(false);
    expect(store.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});

describe('Store — settings and view', () => {
  it('merges settings', () => {
    const store = makeStore();
    store.setSettings({ showMinimap: false });
    expect(store.getState().settings.showMinimap).toBe(false);
    expect(store.getState().settings.showGrid).toBe(true);
  });

  it('never keeps an API key in renderer storage', () => {
    const store = makeStore();
    store.setSettings({
      provider: { ...store.getState().settings.provider, apiKey: 'super-secret' },
    });
    const stored = storage.getItem('whatifs:ui');
    expect(stored).not.toContain('super-secret');
  });

  it('switches the view mode', () => {
    const store = makeStore();
    store.setViewMode('dossier');
    expect(store.getState().viewMode).toBe('dossier');
    expect(storage.getItem('whatifs:view')).toBe('dossier');
  });
});

describe('Store — a new universe from the form', () => {
  it('reads the figures and constraints the person supplied', () => {
    const store = makeStore();
    store.newUniverse({
      situation: 'I am considering moving abroad for work and have savings put aside.',
      decision: 'Should I move abroad?',
      goals: 'stability, family',
      constraints: 'visa, family commitments',
      resources: 'savings 21000, income 3400, rent 1500',
      horizon: 36,
      imagination: 0.4,
      branchCount: 3,
    });

    const doc = store.getState().doc;
    expect(doc.prompt.resources).toEqual(['savings 21000', 'income 3400', 'rent 1500']);
    expect(doc.prompt.constraints).toEqual(['visa', 'family commitments']);
    const value = (key: string): number | undefined =>
      doc.assumptions.find((a) => a.varKey === key)?.value;
    expect(value('money')).toBe(21_000);
    expect(value('income')).toBe(3_400);
    expect(value('expenses')).toBe(1_500);
    expect(doc.prompt.archetypes).toContain('relocation');
  });

  it('marks unsupplied figures as defaults rather than pretending they were given', () => {
    const store = makeStore();
    store.newUniverse({
      situation: 'I am deciding whether to go back to university for a degree.',
      decision: 'Should I study full time?',
      goals: 'a better career',
      horizon: 60,
      imagination: 0.35,
      branchCount: 3,
    });
    const funds = store.getState().doc.assumptions.find((a) => a.id === 'a.funds');
    expect(funds?.rationale).toMatch(/Not stated/);
  });

  it('shortens a long decision at a word boundary, not mid-word', () => {
    const store = makeStore();
    store.newUniverse({
      situation: 'I am deciding what to do about study and work over the next few years.',
      decision:
        'Should I study full time, study part time, or build the skills without a course at all?',
      goals: 'a better career',
      horizon: 60,
      imagination: 0.35,
      branchCount: 3,
    });
    const title = store.getState().doc.title;
    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.endsWith('…')).toBe(true);
    // Nothing after the final space may be a partial word.
    const head = title.slice(0, -1);
    expect(head.endsWith(' ')).toBe(false);
    expect(head.split(' ').at(-1)).toMatch(/^[a-z]+$/);
  });

  it('returns to the graph when a new universe replaces the open one', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    store.openUniverseDiff(parent.id);
    expect(store.getState().viewMode).toBe('universes');

    store.newUniverse({
      situation: 'I am deciding whether to move abroad for a job.',
      decision: 'Should I move?',
      goals: 'stability',
      horizon: 36,
      imagination: 0.4,
      branchCount: 3,
    });

    expect(store.getState().viewMode).toBe('graph');
    expect(store.getState().universePair).toBeNull();
    expect(storage.getItem('whatifs:view')).toBe('graph');
  });
});

describe('Store — comparing two paths', () => {
  it('leaves the starting point out of the paths that can be compared', () => {
    const store = makeStore();
    const startBranch = Object.values(store.getState().doc.nodes).find(
      (n) => n.type === 'start'
    )?.branch;
    const comparable = store.comparableBranches();
    expect(comparable.length).toBeGreaterThanOrEqual(2);
    expect(comparable.some((b) => b.id === startBranch)).toBe(false);
  });

  it('opens the diff on a pair of paths', () => {
    const store = makeStore();
    store.openDiff();
    const pair = store.getState().diffBranches;
    expect(pair).not.toBeNull();
    expect(store.getState().viewMode).toBe('diff');
    if (!pair) return;
    expect(pair.a).not.toBe(pair.b);
  });

  it('builds the diff for a pair and caches it', () => {
    const store = makeStore();
    const comparable = store.comparableBranches();
    const a = comparable[0]!.id;
    const b = comparable[1]!.id;
    const first = store.diffFor(a, b);
    expect(first).not.toBeNull();
    expect(store.diffFor(a, b)).toBe(first);
  });

  it('returns nothing for a path that does not exist', () => {
    const store = makeStore();
    expect(store.diffFor('nope', 'also-nope')).toBeNull();
  });

  it('remembers the pair so a reopened app does not lose it', () => {
    const store = makeStore();
    store.setDiffBranches({ a: 'b1', b: 'b2' });
    expect(storage.getItem('whatifs:diff')).toContain('b1');
  });

  it('falls back to the first two paths when the remembered pair no longer exists', () => {
    const store = makeStore();
    store.setDiffBranches({ a: 'gone-a', b: 'gone-b' });
    store.openDiff();
    const pair = store.getState().diffBranches;
    expect(pair).not.toBeNull();
    if (!pair) return;
    const ids = store.comparableBranches().map((b) => b.id);
    expect(ids).toContain(pair.a);
    expect(ids).toContain(pair.b);
  });
});

describe('Store — comparing two universes', () => {
  it('saves the parent before switching to a counterfactual', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    const child = store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    expect(child).not.toBeNull();
    if (!child) return;

    // The parent is now a real library entry, not just an undo step.
    expect(storage.getItem(`whatifs:doc:${parent.id}`)).not.toBeNull();
    expect(store.getState().library.some((x) => x.id === parent.id)).toBe(true);
    expect(store.getState().doc.id).toBe(child.id);
  });

  it('lists the other saved universes, newest first', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    const other = store.comparableUniverses();
    expect(other.some((x) => x.id === parent.id)).toBe(true);
    expect(other.some((x) => x.id === store.getState().doc.id)).toBe(false);
    for (let i = 1; i < other.length; i += 1) {
      expect(other[i - 1]!.updatedAt >= other[i]!.updatedAt).toBe(true);
    }
  });

  it('removes a deleted universe from the library and the comparison picker', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    expect(store.comparableUniverses().some((x) => x.id === parent.id)).toBe(true);

    store.deleteFromLibrary(parent.id);
    expect(store.getState().library.some((x) => x.id === parent.id)).toBe(false);
    expect(store.comparableUniverses().some((x) => x.id === parent.id)).toBe(false);
    expect(store.loadDoc(parent.id)).toBeNull();
  });

  it('opens a universe diff against the open universe', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    const child = store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    if (!child) return;

    store.openUniverseDiff(parent.id);
    const pair = store.getState().universePair;
    expect(pair).toEqual({ a: child.id, b: parent.id });
    expect(store.getState().viewMode).toBe('universes');
    expect(storage.getItem('whatifs:universes')).toContain(parent.id);

    const diff = store.universeDiffFor();
    expect(diff).not.toBeNull();
    expect(diff?.relationship.kind).toBe('a-from-b');
    expect(diff?.changedAssumptions.map((x) => x.key)).toContain('a.funds');
    // Cached until the document changes.
    expect(store.universeDiffFor()).toBe(diff);
  });

  it('reopens the remembered comparison without asking again', () => {
    const store = makeStore();
    const parent = store.getState().doc;
    store.makeCounterfactual('a.funds', 25_000, 'A test fork');
    store.openUniverseDiff(parent.id);
    store.setViewMode('graph');
    store.openModal({ kind: 'library' });

    store.showUniverseDiff();
    expect(store.getState().viewMode).toBe('universes');
    expect(store.getState().modal?.kind).toBe('library');
  });

  it('asks for a pair when there is no usable comparison', () => {
    const store = makeStore();
    store.showUniverseDiff();
    expect(store.getState().viewMode).toBe('graph');
    expect(store.getState().modal?.kind).toBe('universes');
  });

  it('does not show a remembered comparison between two other universes', () => {
    const store = makeStore();
    store.setUniversePair({ a: 'sim_other_a', b: 'sim_other_b' });
    store.showUniverseDiff();
    expect(store.getState().viewMode).toBe('graph');
    expect(store.getState().modal?.kind).toBe('universes');
  });

  it('refuses to compare a universe with itself or with a missing one', () => {
    const store = makeStore();
    store.openUniverseDiff(store.getState().doc.id);
    expect(store.getState().universePair).toBeNull();
    expect(store.getState().viewMode).toBe('graph');

    store.openUniverseDiff('missing-universe');
    expect(store.getState().universePair).toBeNull();
    expect(store.getState().toasts.some((x) => x.kind === 'error')).toBe(true);
  });
});
