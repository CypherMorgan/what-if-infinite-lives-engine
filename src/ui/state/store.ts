/**
 * Renderer application state.
 *
 * Plain observable store (no external state library) so the whole UI stays
 * dependency-light and auditable. Every mutation that changes the simulation
 * document goes through `run()`, which is what gives us undo/redo, dirty
 * tracking and a single place to persist.
 */
import { useSyncExternalStore } from 'react';
import type {
  Assumption,
  BranchId,
  NodeId,
  ScenarioPrompt,
  SimulationDoc,
  SimulationSummary,
  StateVector,
} from '../../core/types';
import {
  createUniverse,
  expandNode,
  forecastFrom,
  outcomeSpread,
  pathTo,
  updateAssumptions,
} from '../../core/engine';
import { runLayout } from '../../core/layout';
import { ALL_PACKS } from '../../core/packs';
import {
  applyAssumptionChange,
  applyDecisionChange,
  changedAssumptions,
  diffSnapshots,
  noisyKeys,
  reroll,
  snapshot,
  stabilityBetween,
  whyThisPath,
  type BranchSnapshot,
  type DiffEntry,
  type StabilityReport,
} from '../../core/counterfactual';
import { visibleNodes } from '../../core/graph';
import { randomSeed } from '../../core/rng';
import { detectArchetypes } from '../../core/archetypes';
import { exportFileName, exportToText, importFromText, summarise } from '../../core/importExport';
import type { ProviderSettings } from '../../ai/provider';
import { DEFAULT_SETTINGS } from '../../ai/provider';
import { generateUniverse } from '../../ai/orchestrator';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface UiSettings {
  reducedMotion: boolean;
  showMinimap: boolean;
  showSpread: boolean;
  showGrid: boolean;
  provider: ProviderSettings;
}

const DEFAULT_UI: UiSettings = {
  reducedMotion:
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  showMinimap: true,
  showSpread: true,
  showGrid: true,
  provider: DEFAULT_SETTINGS,
};

const LS_UI = 'whatifs:ui';
const LS_INDEX = 'whatifs:index';

function loadUi(): UiSettings {
  try {
    const raw = localStorage.getItem(LS_UI);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiSettings>;
      return {
        ...DEFAULT_UI,
        ...parsed,
        // never restore an API key from renderer storage
        provider: { ...DEFAULT_SETTINGS, ...(parsed.provider ?? {}), apiKey: undefined },
      };
    }
  } catch {
    /* corrupted settings fall back to defaults */
  }
  return DEFAULT_UI;
}

function saveUi(s: UiSettings): void {
  try {
    const safe: UiSettings = { ...s, provider: { ...s.provider, apiKey: undefined } };
    localStorage.setItem(LS_UI, JSON.stringify(safe));
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

interface HistoryEntry {
  label: string;
  doc: SimulationDoc;
}

const HISTORY_LIMIT = 50;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export type ToastKind = 'info' | 'error' | 'success';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface AppState {
  doc: SimulationDoc;
  selected: NodeId | null;
  selectedEdge: string | null;
  /** Nodes along the path from the start node to the selection, for emphasis. */
  path: NodeId[];
  query: string;
  camera: { x: number; y: number; scale: number };
  settings: UiSettings;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  status: string;
  toasts: Toast[];
  modal: ModalState | null;
  compare: CompareState | null;
  library: SimulationSummary[];
  viewMode: 'graph' | 'timeline';
}

export type ModalState =
  | { kind: 'new' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings' }
  | { kind: 'about' }
  | { kind: 'counterfactual'; assumptionId: string }
  | { kind: 'library' }
  | { kind: 'shortcuts' };

export interface CompareState {
  a: BranchSnapshot;
  b: BranchSnapshot;
  diffs: DiffEntry[];
  stability: StabilityReport;
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private toastSeq = 0;

  constructor(doc: SimulationDoc) {
    this.state = {
      doc,
      selected: doc.focusNode ?? firstNodeId(doc),
      selectedEdge: null,
      path: doc.focusNode ? pathTo(doc, doc.focusNode) : [],
      query: '',
      camera: doc.camera ?? { x: 0, y: 0, scale: 1 },
      settings: loadUi(),
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      busy: false,
      status: 'Ready.',
      toasts: [],
      modal: null,
      compare: null,
      library: loadIndex(),
      viewMode: ((): 'graph' | 'timeline' => {
        try {
          return (localStorage.getItem('whatifs:view') as 'graph' | 'timeline') || 'graph';
        } catch {
          return 'graph';
        }
      })(),
    };
  }

  getState = (): AppState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /* ---------------- toasts / status ---------------- */

  toast(text: string, kind: ToastKind = 'info'): void {
    const t: Toast = { id: ++this.toastSeq, kind, text };
    this.set({ toasts: [...this.state.toasts, t] });
    window.setTimeout(
      () => {
        this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) });
      },
      kind === 'error' ? 6000 : 3200
    );
  }

  setStatus(status: string): void {
    this.set({ status });
  }

  setBusy(busy: boolean): void {
    this.set({ busy });
  }

  openModal(modal: ModalState | null): void {
    this.set({ modal });
  }

  /* ---------------- history ---------------- */

  run(label: string, next: SimulationDoc | null, reason?: string): void {
    if (!next) return;
    const before = this.state.doc;
    if (next === before) return;
    this.past.push({ label, doc: before });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.commit(next, reason ?? label);
  }

  private commit(doc: SimulationDoc, status: string): void {
    const selected =
      this.state.selected && doc.nodes[this.state.selected]
        ? this.state.selected
        : firstNodeId(doc);
    this.set({
      doc,
      selected,
      path: selected ? pathTo(doc, selected) : [],
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past[this.past.length - 1]?.label ?? null,
      redoLabel: this.future[this.future.length - 1]?.label ?? null,
      status,
    });
    this.saveLibraryEntry(doc);
    this.persistDoc(doc);
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ label: entry.label, doc: this.state.doc });
    this.commit(entry.doc, `Undo: ${entry.label}`);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ label: entry.label, doc: this.state.doc });
    this.commit(entry.doc, `Redo: ${entry.label}`);
  }

  /* ---------------- selection / view ---------------- */

  select(nodeId: NodeId | null): void {
    if (!nodeId) {
      this.set({ selected: null, selectedEdge: null, path: [] });
      return;
    }
    this.set({ selected: nodeId, selectedEdge: null, path: pathTo(this.state.doc, nodeId) });
    this.persistFocus(nodeId);
  }

  selectEdge(edgeId: string | null): void {
    this.set({ selectedEdge: edgeId });
  }

  setQuery(query: string): void {
    this.set({ query });
  }

  setCamera(camera: Partial<AppState['camera']>): void {
    this.set({ camera: { ...this.state.camera, ...camera } });
  }

  /** Pan the camera so a node sits in the middle of the stage. */
  centerOn(nodeId: NodeId, scale?: number): void {
    const p = this.state.doc.layout[nodeId];
    if (!p) return;
    this.set({ camera: { x: p.x, y: p.y, scale: scale ?? this.state.camera.scale } });
  }

  setSettings(patch: Partial<UiSettings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    saveUi(settings);
  }

  setCompare(c: CompareState | null): void {
    this.set({ compare: c });
  }

  setViewMode(mode: 'graph' | 'timeline'): void {
    this.set({ viewMode: mode });
    try {
      localStorage.setItem('whatifs:view', mode);
    } catch {
      // ignore
    }
  }

  visible(): Set<NodeId> {
    return new Set(visibleNodes(this.state.doc).map((n) => n.id));
  }

  /* ---------------- universe lifecycle ---------------- */

  newUniverse(input: {
    situation: string;
    decision: string;
    goals: string;
    horizon: number;
    imagination: number;
    branchCount: number;
  }): void {
    const text = `${input.situation} ${input.decision} ${input.goals}`;
    const archetypes = detectArchetypes(text);
    const prompt: ScenarioPrompt = {
      situation: input.situation.trim(),
      decision: input.decision.trim(),
      goals: splitLines(input.goals),
      constraints: [],
      horizon: input.horizon,
      branchCount: input.branchCount,
      imagination: input.imagination,
      resources: [],
      archetypes: archetypes.length > 0 ? archetypes : ['uncertainty'],
      title: input.decision.trim().slice(0, 72) || 'New universe',
    };
    const seed = randomSeed();
    const doc = createUniverse({ packs: ALL_PACKS, seed, prompt });
    this.past = [];
    this.future = [];
    this.commit(doc, `Created “${doc.title}”`);
    this.select(firstNodeId(doc));
    this.toast(
      `Universe created — ${Object.keys(doc.nodes).length} nodes, ${Object.keys(doc.branches).length} branches.`,
      'success'
    );
  }

  /** Regenerate the whole universe with a fresh seed, keeping the prompt. */
  rerollUniverse(): void {
    const doc = reroll(this.state.doc, ALL_PACKS, randomSeed());
    this.run('Reroll universe', doc);
    this.toast('Rerolled with a new seed.', 'success');
  }

  async regenerateWithProvider(): Promise<void> {
    const { settings, doc } = this.state;
    this.setBusy(true);
    this.setStatus(`Generating via ${settings.provider.id}…`);
    try {
      const outcome = await generateUniverse({
        prompt: doc.prompt,
        settings: settings.provider,
        seed: randomSeed(),
        id: doc.id,
      });
      if (outcome.ok) {
        this.run(
          'Generate with provider',
          outcome.doc,
          `Generated via ${outcome.result.providerLabel}`
        );
        this.select(firstNodeId(outcome.doc));
        this.toast(
          `Generated via ${outcome.result.providerLabel} in ${outcome.result.elapsedMs} ms.`,
          'success'
        );
      } else {
        this.setStatus(`Generation failed: ${outcome.error.message}`);
        this.toast(outcome.error.message, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`Generation failed: ${msg}`);
      this.toast(msg, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /* ---------------- graph edits ---------------- */

  expandNode(nodeId: NodeId): void {
    const before = this.state.doc;
    const node = before.nodes[nodeId];
    if (!node) return;
    if (!node.expandable) {
      this.toast('This node has no further plausible steps — it is a future state.', 'info');
      return;
    }
    if (node.expanded) {
      this.toast(
        'Already expanded. Use “What if…” to explore a different assumption here.',
        'info'
      );
      return;
    }
    const result = expandNode(before, nodeId, ALL_PACKS);
    if (result.added.length === 0) {
      this.toast('The rule catalogue has no further steps for this state.', 'info');
      return;
    }
    // place the new nodes to the right of their parents
    const layout = { ...result.doc.layout };
    for (const id of result.added) {
      if (layout[id]) continue;
      const parent = result.doc.nodes[id]?.parents[0];
      const base = parent ? layout[parent] : undefined;
      const idx = result.added.indexOf(id);
      layout[id] = {
        x: (base?.x ?? 0) + 360,
        y: (base?.y ?? 0) + (idx - (result.added.length - 1) / 2) * 138,
      };
    }
    const doc: SimulationDoc = { ...result.doc, layout, updatedAt: new Date().toISOString() };
    this.run(`Expand “${node.title}”`, doc);
    this.set({ selected: result.added[0] ?? nodeId, path: pathTo(doc, result.added[0] ?? nodeId) });
    this.toast(
      `Added ${result.added.length} step${result.added.length === 1 ? '' : 's'}.`,
      'success'
    );
    this.recentlyAdded = result.added;
  }

  /** Ids added by the most recent expansion — the renderer animates these. */
  recentlyAdded: NodeId[] = [];

  toggleBranchCollapse(branchId: BranchId): void {
    const doc = this.state.doc;
    const collapsed = doc.collapsed.includes(branchId)
      ? doc.collapsed.filter((b) => b !== branchId)
      : [...doc.collapsed, branchId];
    const next = runLayout({ ...doc, collapsed, updatedAt: new Date().toISOString() });
    this.run(doc.collapsed.includes(branchId) ? `Show branch` : `Collapse branch`, next);
  }

  relayout(): void {
    const next = runLayout({ ...this.state.doc, updatedAt: new Date().toISOString() });
    this.run('Auto-layout', next);
    this.toast('Layout recomputed.', 'info');
  }

  /** Replace the document without touching history (used during node drags). */
  transientDoc(doc: SimulationDoc): void {
    this.set({ doc });
  }

  /** Live rename while typing — history entry is recorded by `commitTitle`. */
  renameTitle(title: string): void {
    if (this.titleBefore === null) this.titleBefore = this.state.doc.title;
    this.set({ doc: { ...this.state.doc, title } });
  }

  /** Update user notes for a node. */
  setNodeNotes(nodeId: string, userNotes: string): void {
    const node = this.state.doc.nodes[nodeId];
    if (!node) return;
    this.run(`Update notes for “${node.title}”`, {
      ...this.state.doc,
      nodes: {
        ...this.state.doc.nodes,
        [nodeId]: { ...node, userNotes },
      },
      updatedAt: new Date().toISOString(),
    });
  }

  private titleBefore: string | null = null;

  commitTitle(): void {
    const before = this.titleBefore;
    this.titleBefore = null;
    if (before === null || before === this.state.doc.title) return;
    this.commitTransient('Rename universe', { ...this.state.doc, title: before });
  }

  /** Finish a transient edit: record `before` as the undo point. */
  commitTransient(label: string, before: SimulationDoc): void {
    if (before === this.state.doc) return;
    this.past.push({ label, doc: before });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.commit(this.state.doc, label);
  }

  /* ---------------- assumptions & counterfactuals ---------------- */

  previewAssumption(assumptionId: string, value: number): void {
    const doc = updateAssumptions(this.state.doc, { [assumptionId]: value });
    this.set({ doc, status: `Preview ${assumptionId} = ${value}` });
  }

  commitAssumption(assumptionId: string, value: number): void {
    const assumption = this.state.doc.assumptions.find((a) => a.id === assumptionId);
    const doc = updateAssumptions(this.state.doc, { [assumptionId]: value });
    this.run(`Assumption: ${assumption?.label ?? assumptionId} = ${value}`, doc);
  }

  /** Create a real counterfactual universe from an assumption change. */
  makeCounterfactual(assumptionId: string, value: number, note: string): SimulationDoc | null {
    const outcome = applyAssumptionChange(this.state.doc, assumptionId, value, ALL_PACKS, note);
    if ('error' in outcome) {
      this.toast(outcome.error, 'error');
      return null;
    }
    this.run(`What if: ${outcome.counterfactual.target}`, outcome.doc);
    this.toast('Counterfactual universe created — it now lives in your library.', 'success');
    return outcome.doc;
  }

  /** Choose a decision option, producing a counterfactual universe. */
  chooseOption(optionId: string): void {
    const outcome = applyDecisionChange(this.state.doc, optionId, ALL_PACKS);
    if ('error' in outcome) {
      this.toast(outcome.error, 'error');
      return;
    }
    this.run(`Choose: ${outcome.counterfactual.target}`, outcome.doc);
    this.toast('Alternative chosen — a new universe was derived.', 'success');
  }

  /* ---------------- comparison ---------------- */

  compareWith(nodeId: NodeId): void {
    const doc = this.state.doc;
    const selfId = this.state.selected ?? firstNodeId(doc);
    if (!selfId || selfId === nodeId) {
      this.toast('Pick a different node to compare against.', 'error');
      return;
    }
    const a = snapshot(doc, selfId);
    const b = snapshot(doc, nodeId);
    if (!a || !b) {
      this.toast('Both nodes need computed state to be comparable.', 'error');
      return;
    }
    this.setCompare({
      a,
      b,
      diffs: diffSnapshots(a, b),
      stability: stabilityBetween(a, b, noisyKeys(ALL_PACKS)),
    });
    this.setStatus(`Comparing ${a.title} → ${b.title}`);
  }

  explainPath(): string[] {
    const id = this.state.selected;
    return id ? whyThisPath(this.state.doc, id) : [];
  }

  /* ---------------- import / export ---------------- */

  exportText(): string {
    return exportToText(this.state.doc);
  }

  exportName(): string {
    return exportFileName(this.state.doc);
  }

  importText(text: string): boolean {
    const result = importFromText(text);
    if (!result.ok) {
      this.toast(
        `${result.error.message}${result.error.detail ? ` — ${result.error.detail}` : ''}`,
        'error'
      );
      return false;
    }
    const { doc, notes, warnings } = result.value;
    this.past = [];
    this.future = [];
    this.commit(doc, `Imported “${doc.title}”`);
    this.select(doc.focusNode ?? firstNodeId(doc));
    for (const n of notes) this.toast(n, 'info');
    for (const w of warnings) this.toast(w, 'error');
    this.toast(`Imported ${Object.keys(doc.nodes).length} nodes.`, 'success');
    return true;
  }

  /* ---------------- library ---------------- */

  refreshLibrary(): void {
    this.set({ library: loadIndex() });
  }

  private saveLibraryEntry(doc: SimulationDoc): void {
    try {
      const items = loadIndex().filter((s) => s.id !== doc.id);
      items.push(summarise(doc));
      localStorage.setItem(LS_INDEX, JSON.stringify(items.slice(-40)));
      this.set({ library: items.slice(-40) });
    } catch {
      /* storage unavailable */
    }
  }

  /* ---------------- persistence ---------------- */

  private persistDoc(doc: SimulationDoc): void {
    try {
      localStorage.setItem(`whatifs:doc:${doc.id}`, exportToText(doc));
      localStorage.setItem('whatifs:last', doc.id);
    } catch {
      /* quota exceeded or unavailable */
    }
  }

  private persistFocus(nodeId: NodeId): void {
    const doc = { ...this.state.doc, focusNode: nodeId, camera: this.state.camera };
    this.set({ doc });
    try {
      localStorage.setItem(`whatifs:doc:${doc.id}`, exportToText(doc));
    } catch {
      /* ignore */
    }
  }

  saveCamera(): void {
    const { doc, camera } = this.state;
    const next = { ...doc, camera };
    this.set({ doc: next });
    try {
      localStorage.setItem(`whatifs:doc:${next.id}`, exportToText(next));
    } catch {
      /* ignore */
    }
  }

  /* ---------------- derived helpers ---------------- */

  assumptionById(id: string): Assumption | undefined {
    return this.state.doc.assumptions.find((a) => a.id === id);
  }

  spreadFor(nodeId: NodeId, metricKey: string) {
    return outcomeSpread(this.state.doc, nodeId, ALL_PACKS, metricKey, 16);
  }

  forecastFor(nodeId: NodeId, months: number): StateVector | null {
    return forecastFrom(this.state.doc, nodeId, ALL_PACKS, months);
  }

  diffAgainstParent(): DiffEntry[] {
    const parentId = this.state.doc.parentId;
    if (!parentId) return [];
    const parent = this.loadDoc(parentId);
    return parent ? changedAssumptions(parent, this.state.doc) : [];
  }

  loadDoc(id: string): SimulationDoc | null {
    try {
      const raw = localStorage.getItem(`whatifs:doc:${id}`);
      if (!raw) return null;
      const result = importFromText(raw);
      return result.ok ? result.value.doc : null;
    } catch {
      return null;
    }
  }

  openFromLibrary(id: string): void {
    const doc = this.loadDoc(id);
    if (!doc) {
      this.toast('That universe could not be loaded.', 'error');
      return;
    }
    this.past = [];
    this.future = [];
    this.commit(doc, `Opened “${doc.title}”`);
    this.select(doc.focusNode ?? firstNodeId(doc));
  }

  deleteFromLibrary(id: string): void {
    try {
      localStorage.removeItem(`whatifs:doc:${id}`);
    } catch {
      /* ignore */
    }
    this.refreshLibrary();
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function firstNodeId(doc: SimulationDoc): NodeId | null {
  const start = Object.values(doc.nodes).find((n) => n.type === 'start');
  return start?.id ?? Object.keys(doc.nodes)[0] ?? null;
}

function splitLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5);
}

function loadIndex(): SimulationSummary[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SimulationSummary[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** React binding. */
export function useAppState(store: Store): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
