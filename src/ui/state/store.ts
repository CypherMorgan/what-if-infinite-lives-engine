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
  SimId,
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
  withSensitivity,
  type BranchSnapshot,
  type DiffEntry,
  type StabilityReport,
} from '../../core/counterfactual';
import { visibleNodes } from '../../core/graph';
import { buildDossier, type Dossier } from '../../core/dossier';
import { buildBranchDiff, type BranchDiff } from '../../core/branchDiff';
import { buildUniverseDiff, type UniverseDiff, type UniverseRef } from '../../core/universeDiff';
import { randomSeed } from '../../core/rng';
import { detectArchetypes } from '../../core/archetypes';
import { exportFileName, exportToText, importFromText, summarise } from '../../core/importExport';
import { IMPORT_LIMITS } from '../../core/validate';
import type { ProviderSettings } from '../../ai/provider';
import { DEFAULT_SETTINGS } from '../../ai/provider';
import { generateUniverse } from '../../ai/orchestrator';
import { createDesktopTransport } from '../../ai/desktopTransport';

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
const LS_DIFF = 'whatifs:diff';
const LS_UNIVERSE_PAIR = 'whatifs:universes';

/**
 * The pair of universes last compared.
 *
 * Kept beside the branch pair so reopening the app does not lose either
 * comparison. It is read defensively: a stale id simply means the pair is
 * offered again rather than crashing.
 */
function loadUniversePair(): { a: SimId; b: SimId } | null {
  try {
    const raw = localStorage.getItem(LS_UNIVERSE_PAIR);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown };
    if (typeof parsed.a === 'string' && typeof parsed.b === 'string') {
      return { a: parsed.a, b: parsed.b };
    }
  } catch {
    /* corrupted pair falls back to none */
  }
  return null;
}

/**
 * The pair of paths last compared.
 *
 * Remembered so that reopening the app does not lose the comparison a person
 * was in the middle of reading.
 */
function loadDiffPair(): { a: string; b: string } | null {
  try {
    const raw = localStorage.getItem(LS_DIFF);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown };
    if (typeof parsed.a === 'string' && typeof parsed.b === 'string') {
      return { a: parsed.a, b: parsed.b };
    }
  } catch {
    /* corrupted pair falls back to none */
  }
  return null;
}

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

export type ViewMode = 'graph' | 'timeline' | 'dossier' | 'diff' | 'universes';

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
  viewMode: ViewMode;
  /** The two branches being compared in the diff view. */
  diffBranches: { a: string; b: string } | null;
  /** The two universes being compared, by document id. */
  universePair: { a: SimId; b: SimId } | null;
}

export type ModalState =
  | { kind: 'new' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings' }
  | { kind: 'about' }
  | { kind: 'counterfactual'; assumptionId: string }
  | { kind: 'library' }
  | { kind: 'shortcuts' }
  | { kind: 'compare' }
  | { kind: 'universes' }
  | { kind: 'notes' };

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
  /**
   * Dossiers are expensive to build (a projection plus a spread of samples),
   * so they are cached per node until the document changes.
   */
  private dossierCache = new Map<NodeId, Dossier | null>();
  /** Diffs are cached per pair of branches, on the same terms as dossiers. */
  private diffCache = new Map<string, BranchDiff | null>();
  /** Universe diffs are cached per pair of documents, on the same terms. */
  private universeCache = new Map<string, UniverseDiff | null>();

  constructor(doc: SimulationDoc) {
    // The path is derived from the selected node, so it has to be filled in
    // here too. Leaving it empty meant a freshly opened universe showed a
    // selected starting point with an empty path behind it.
    const selected = doc.focusNode ?? firstNodeId(doc);
    const universePair = loadUniversePair();
    this.state = {
      doc,
      selected,
      selectedEdge: null,
      path: selected ? pathTo(doc, selected) : [],
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
      diffBranches: loadDiffPair(),
      universePair,
      viewMode: ((): ViewMode => {
        try {
          const saved = localStorage.getItem('whatifs:view');
          // A universe comparison is only meaningful when the open universe is
          // one side of it. Restoring a pair between two other documents would
          // put a comparison on screen that the header's title contradicts.
          const pairInvolvesDoc =
            universePair !== null && (universePair.a === doc.id || universePair.b === doc.id);
          if (saved === 'universes' && !pairInvolvesDoc) return 'graph';
          if (
            saved === 'timeline' ||
            saved === 'dossier' ||
            saved === 'diff' ||
            saved === 'universes'
          ) {
            return saved;
          }
          return 'graph';
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
    // The timer is scheduled through whichever timer exists. The store is
    // renderer code, but keeping it free of a hard `window` dependency means it
    // can be exercised directly by the tests.
    const schedule =
      typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout.bind(window)
        : setTimeout;
    schedule(
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
    // Score assumption influence on every committed document. The score is derived
    // from the document, so recomputing it here keeps it correct no matter which
    // path produced the change (create, expand, assumption edit, undo, redo).
    const scored = withSensitivity(doc, ALL_PACKS);
    const selected =
      this.state.selected && scored.nodes[this.state.selected]
        ? this.state.selected
        : firstNodeId(scored);
    this.dossierCache.clear();
    this.diffCache.clear();
    this.universeCache.clear();
    this.set({
      doc: scored,
      selected,
      path: selected ? pathTo(scored, selected) : [],
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past[this.past.length - 1]?.label ?? null,
      redoLabel: this.future[this.future.length - 1]?.label ?? null,
      status,
    });
    this.saveLibraryEntry(scored);
    this.persistDoc(scored);
  }

  /**
   * Returns to the graph after the open document is replaced.
   *
   * A path comparison or a universe comparison belongs to the document that
   * was open when it was made. Left on screen after switching, it would
   * describe universes the person is no longer looking at, so both pairs are
   * dropped and the graph is shown instead.
   */
  private showGraphForNewDoc(): void {
    this.set({ universePair: null, diffBranches: null });
    this.setViewMode('graph');
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

  setViewMode(mode: ViewMode): void {
    this.set({ viewMode: mode });
    try {
      localStorage.setItem('whatifs:view', mode);
    } catch {
      // ignore
    }
  }

  /* ---------------- branch comparison ---------------- */

  /**
   * The branches that can be compared.
   *
   * The starting point is not a path — it is where every path begins — so it
   * is left out. Comparing it against a path would answer "what does three
   * years of anything do to me", which is a different question.
   */
  comparableBranches(): { id: string; name: string; hue: number }[] {
    const startBranch = Object.values(this.state.doc.nodes).find((n) => n.type === 'start')?.branch;
    return Object.values(this.state.doc.branches)
      .filter((b) => b.id !== startBranch)
      .map((b) => ({ id: b.id, name: b.name, hue: b.hue }));
  }

  /** Opens the diff on a pair of branches, defaulting to the first two paths. */
  openDiff(a?: string, b?: string): void {
    const branches = this.comparableBranches();
    if (branches.length < 2) {
      this.toast('There are not two paths to compare yet.', 'info');
      return;
    }
    // A pair remembered from an earlier session may name paths this universe
    // does not have. In that case fall back to the first two real paths.
    const current = this.state.diffBranches;
    const usable =
      current !== null &&
      branches.some((x) => x.id === current.a) &&
      branches.some((x) => x.id === current.b);
    const first = a ?? (usable ? current!.a : branches[0]!.id);
    const second =
      b ?? (usable ? current!.b : (branches.find((x) => x.id !== first)?.id ?? branches[1]!.id));
    this.setDiffBranches({ a: first, b: second });
    this.setViewMode('diff');
  }

  setDiffBranches(pair: { a: string; b: string }): void {
    this.set({ diffBranches: pair });
    try {
      localStorage.setItem('whatifs:diff', JSON.stringify(pair));
    } catch {
      // ignore
    }
  }

  /** The diff for a pair of branches. Cached until the document changes. */
  diffFor(a: string, b: string): BranchDiff | null {
    const key = `${a}|${b}`;
    if (this.diffCache.has(key)) return this.diffCache.get(key) ?? null;
    const built = buildBranchDiff(this.state.doc, a, b, ALL_PACKS);
    this.diffCache.set(key, built);
    return built;
  }

  /* ---------------- universe comparison ---------------- */

  /** Saved universes other than the one currently open, newest first. */
  comparableUniverses(): SimulationSummary[] {
    const seen = new Set<SimId>([this.state.doc.id]);
    const out: SimulationSummary[] = [];
    for (const item of this.state.library) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Compares the open universe with another saved one.
   *
   * The open document is always the first side, because the question being
   * asked is "what did changing this do to the universe I am looking at?".
   */
  openUniverseDiff(bId: SimId): void {
    if (bId === this.state.doc.id) {
      this.toast('Pick a different universe to compare with.', 'info');
      return;
    }
    if (!this.loadDoc(bId)) {
      this.toast('That universe could not be loaded.', 'error');
      return;
    }
    this.setUniversePair({ a: this.state.doc.id, b: bId });
    this.setViewMode('universes');
  }

  setUniversePair(pair: { a: SimId; b: SimId }): void {
    this.set({ universePair: pair });
    try {
      localStorage.setItem(LS_UNIVERSE_PAIR, JSON.stringify(pair));
    } catch {
      // ignore
    }
  }

  /** Reopens the remembered universe comparison, or asks for a pair. */
  showUniverseDiff(): void {
    const pair = this.state.universePair;
    // The open universe is always one side of a comparison. A remembered pair
    // between two other documents is not this comparison, so it is treated as
    // missing rather than shown with the wrong universe in the header.
    const involvesOpenDoc =
      pair !== null && (pair.a === this.state.doc.id || pair.b === this.state.doc.id);
    if (pair && involvesOpenDoc && pair.a !== pair.b && this.universeDiffFor(pair)) {
      this.setViewMode('universes');
      return;
    }
    this.openModal({ kind: 'universes' });
  }

  /** The diff for the remembered universe pair, or an explicit one. */
  universeDiffFor(
    pair: { a: SimId; b: SimId } | null = this.state.universePair
  ): UniverseDiff | null {
    if (!pair) return null;
    if (pair.a === pair.b) return null;
    const key = `${pair.a}|${pair.b}`;
    if (this.universeCache.has(key)) return this.universeCache.get(key) ?? null;

    const aDoc = this.docFor(pair.a);
    const bDoc = this.docFor(pair.b);
    if (!aDoc || !bDoc) {
      this.universeCache.set(key, null);
      return null;
    }
    const built = buildUniverseDiff(aDoc, bDoc, ALL_PACKS, { refs: this.universeRefs() });
    this.universeCache.set(key, built);
    return built;
  }

  /** The document as it is now for the open universe, as stored for the rest. */
  private docFor(id: SimId): SimulationDoc | null {
    return id === this.state.doc.id ? this.state.doc : this.loadDoc(id);
  }

  /**
   * Lineage refs cheap enough to build from the library index.
   *
   * The open document is included so a universe created in this session can be
   * placed in the family tree before it has been reopened from storage.
   */
  private universeRefs(): UniverseRef[] {
    const refs: UniverseRef[] = [];
    const seen = new Set<SimId>();
    const add = (ref: UniverseRef): void => {
      if (seen.has(ref.id)) return;
      seen.add(ref.id);
      refs.push(ref);
    };
    for (const item of this.state.library) add(refOfSummary(item));
    add(refOfDoc(this.state.doc));
    return refs;
  }

  visible(): Set<NodeId> {
    return new Set(visibleNodes(this.state.doc).map((n) => n.id));
  }

  /* ---------------- universe lifecycle ---------------- */

  newUniverse(input: {
    situation: string;
    decision: string;
    goals: string;
    constraints?: string;
    resources?: string;
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
      constraints: splitLines(input.constraints ?? ''),
      horizon: input.horizon,
      branchCount: input.branchCount,
      imagination: input.imagination,
      resources: splitLines(input.resources ?? ''),
      archetypes: archetypes.length > 0 ? archetypes : ['uncertainty'],
      title: titleFromDecision(input.decision) || 'New universe',
    };
    const seed = randomSeed();
    const doc = createUniverse({ packs: ALL_PACKS, seed, prompt });
    this.past = [];
    this.future = [];
    this.commit(doc, `Created “${doc.title}”`);
    this.showGraphForNewDoc();
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
      // In the desktop app the provider credential lives in the main process,
      // so the request has to be made there too. Without this the provider
      // would always be called without a key and every configured endpoint
      // would fail.
      const transport = createDesktopTransport();
      const outcome = await generateUniverse({
        prompt: doc.prompt,
        settings: settings.provider,
        seed: randomSeed(),
        id: doc.id,
        ...(transport ? { deps: { http: { transport } } } : {}),
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

  /**
   * Replace the universe-level notes.
   *
   * The dialog edits a draft and saves once, so a long note costs one history
   * entry rather than one per keystroke. A no-op save (the text is unchanged)
   * records nothing at all, and the note is capped at the same length the
   * importer accepts so a pasted document cannot fill local storage.
   */
  setSessionNotes(sessionNotes: string): void {
    const next = sessionNotes.slice(0, IMPORT_LIMITS.maxStringLength);
    if (next === this.state.doc.sessionNotes) return;
    this.run('Update session notes', {
      ...this.state.doc,
      sessionNotes: next,
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
    // Remember the parent *before* switching to the fork. Otherwise a universe
    // made this session would exist only in undo history, and the comparison it
    // was forked from could not be reopened afterwards.
    this.rememberDoc(this.state.doc);
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
    this.rememberDoc(this.state.doc);
    this.run(`Choose: ${outcome.counterfactual.target}`, outcome.doc);
    this.toast('Alternative chosen — a new universe was derived.', 'success');
  }

  /** Save a document to the library without making it the open document. */
  private rememberDoc(doc: SimulationDoc): void {
    this.saveLibraryEntry(doc);
    this.persistDoc(doc);
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
    this.showGraphForNewDoc();
    this.select(doc.focusNode ?? firstNodeId(doc));
    for (const n of notes) this.toast(n, 'info');
    for (const w of warnings) this.toast(w, 'error');
    this.toast(`Imported ${Object.keys(doc.nodes).length} nodes.`, 'success');
    return true;
  }

  /* ---------------- library ---------------- */

  refreshLibrary(): void {
    this.universeCache.clear();
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

  /** The plain-language brief for a path. Cached until the document changes. */
  dossierFor(nodeId: NodeId): Dossier | null {
    if (this.dossierCache.has(nodeId)) return this.dossierCache.get(nodeId) ?? null;
    const built = buildDossier(this.state.doc, nodeId, ALL_PACKS, { samples: 24 });
    this.dossierCache.set(nodeId, built);
    return built;
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
    this.showGraphForNewDoc();
    this.select(doc.focusNode ?? firstNodeId(doc));
  }

  deleteFromLibrary(id: string): void {
    try {
      localStorage.removeItem(`whatifs:doc:${id}`);
      // The index is the list the library and the comparison picker read, so
      // removing only the document would leave a row that can never be opened.
      const items = loadIndex().filter((s) => s.id !== id);
      localStorage.setItem(LS_INDEX, JSON.stringify(items));
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

function refOfDoc(doc: SimulationDoc): UniverseRef {
  return {
    id: doc.id,
    title: doc.title,
    ...(doc.parentId ? { parentId: doc.parentId } : {}),
  };
}

function refOfSummary(item: SimulationSummary): UniverseRef {
  return {
    id: item.id,
    title: item.title,
    ...(item.parentId ? { parentId: item.parentId } : {}),
  };
}

function splitLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5);
}

/**
 * A universe title taken from the decision, cut at a word boundary.
 *
 * Templates ask real questions, and a real question is usually longer than a
 * title should be. A hard 72-character cut leaves the header ending mid-word
 * ("…build the skills without a"), which reads like a bug.
 */
function titleFromDecision(decision: string): string {
  const clean = decision.trim().replace(/\s+/g, ' ');
  if (clean.length <= 72) return clean;
  const cut = clean.slice(0, 72);
  const lastSpace = cut.lastIndexOf(' ');
  const head = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]+$/, '');
  return `${head}…`;
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
