/**
 * Application shell: top bar, panels, status bar, toasts and shortcuts.
 */
import { useEffect, useMemo } from 'react';
import { Store, useAppState } from './state/store';
import { Stage } from './components/Stage';
import { LeftPanel } from './components/LeftPanel';
import { Inspector } from './components/Inspector';
import { ModalHost } from './components/Modals';
import { TimelineView } from './components/TimelineView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { pathCount } from '../core/graph';

export function App({ store }: { store: Store }) {
  const state = useAppState(store);

  const title = state.doc.title;

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        store.openModal({ kind: 'new' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        store.openModal({ kind: 'import' });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        store.openModal({ kind: 'export' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('whatifs:focus-search'));
        return;
      }
      if (typing) return;

      if (e.key === 'Escape') {
        if (state.modal) store.openModal(null);
        else if (state.compare) store.setCompare(null);
        else store.select(null);
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        if (state.selected) store.expandNode(state.selected);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        store.setCamera({ scale: Math.min(2.4, state.camera.scale * 1.25) });
        return;
      }
      if (e.key === '-' || e.key === '_') {
        store.setCamera({ scale: Math.max(0.1, state.camera.scale / 1.25) });
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        window.dispatchEvent(new CustomEvent('whatifs:fit'));
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        store.openModal({ kind: 'shortcuts' });
        return;
      }
      if (state.selected && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
        const kids = state.doc.nodes[state.selected]?.children ?? [];
        const next = kids[0];
        if (next) {
          e.preventDefault();
          store.select(next);
          store.centerOn(next);
        }
        return;
      }
      if (state.selected && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
        const parents = state.doc.nodes[state.selected]?.parents ?? [];
        const prev = parents[0];
        if (prev) {
          e.preventDefault();
          store.select(prev);
          store.centerOn(prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, state.modal, state.compare, state.selected, state.camera.scale, state.doc.nodes]);

  /* ---------------- external events (fit to view) ---------------- */
  useEffect(() => {
    const onFit = (): void => {
      window.dispatchEvent(new CustomEvent('whatifs:fit-stage'));
    };
    window.addEventListener('whatifs:fit', onFit);
    return () => window.removeEventListener('whatifs:fit', onFit);
  }, []);

  const nodeCount = useMemo(() => Object.keys(state.doc.nodes).length, [state.doc.nodes]);
  const edgeCount = useMemo(() => Object.keys(state.doc.edges).length, [state.doc.edges]);

  return (
    <div className={state.settings.reducedMotion ? 'app reduced-motion' : 'app'}>
      {/* ---------------- top bar ---------------- */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            WHAT <span className="q">IF?</span>
          </span>
          <span className="brand-sub">infinite lives engine</span>
        </div>

        <input
          className="title-input"
          value={title}
          aria-label="Universe title"
          onChange={(e) => store.renameTitle(e.target.value)}
          onBlur={() => store.commitTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />

        <span className="spacer" />

        <div className="btn-row">
          <button
            className="btn btn-primary"
            onClick={() => store.openModal({ kind: 'new' })}
            title="New universe (Ctrl+N)"
          >
            ✦ New
          </button>
          <button
            className="btn"
            disabled={!state.canUndo}
            onClick={() => store.undo()}
            title={`Undo${state.undoLabel ? `: ${state.undoLabel}` : ''} (Ctrl+Z)`}
          >
            ↶
          </button>
          <button
            className="btn"
            disabled={!state.canRedo}
            onClick={() => store.redo()}
            title={`Redo${state.redoLabel ? `: ${state.redoLabel}` : ''} (Ctrl+Shift+Z)`}
          >
            ↷
          </button>
          <span style={{ width: 1, height: 22, background: 'var(--line)' }} />
          <button
            className="btn btn-violet"
            disabled={!state.selected}
            onClick={() => state.selected && store.expandNode(state.selected)}
            title="Expand the selected node (E)"
          >
            ⤢ Expand
          </button>
          <button
            className="btn btn-amber"
            onClick={() => store.rerollUniverse()}
            title="Re-simulate the same prompt with a new seed"
          >
            ⟳ Reroll
          </button>
        </div>

        <span style={{ width: 1, height: 22, background: 'var(--line)' }} />

        <div className="btn-row">
          <button
            className={`btn ${state.viewMode === 'graph' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => store.setViewMode('graph')}
            title="Graph view"
          >
            Graph
          </button>
          <button
            className={`btn ${state.viewMode === 'timeline' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => store.setViewMode('timeline')}
            title="Timeline view"
          >
            Timeline
          </button>
          <span style={{ width: 1, height: 22, background: 'var(--line)' }} />
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'library' })}
            title="Saved universes"
          >
            ▤ Library
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'import' })}
            title="Import (Ctrl+O)"
          >
            ⬀ Import
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'export' })}
            title="Export (Ctrl+S)"
          >
            ⬇ Export
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'settings' })}
            title="Settings"
          >
            ⚙ Settings
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'shortcuts' })}
            title="Keyboard shortcuts (Ctrl+/)"
          >
            ⌨
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => store.openModal({ kind: 'about' })}
            title="About"
          >
            ⓘ
          </button>
        </div>
      </header>

      {/* ---------------- panels ---------------- */}
      <LeftPanel store={store} />
      <ErrorBoundary>
        {state.viewMode === 'timeline' ? <TimelineView store={store} /> : <Stage store={store} />}
      </ErrorBoundary>
      <ErrorBoundary>
        <Inspector store={store} />
      </ErrorBoundary>

      {/* ---------------- status bar ---------------- */}
      <footer className="status">
        <span className={`status-dot ${state.busy ? 'busy-dot' : ''}`} />
        <span className="status-text">{state.status}</span>
        <span className="chip">{nodeCount} steps</span>
        <span className="chip">{edgeCount} connections</span>
        <span className="chip">{pathCount(state.doc)} paths</span>
        <span
          className={`chip ${state.settings.provider.id === 'offline' ? 'chip-cyan' : 'chip-violet'}`}
        >
          {state.settings.provider.id === 'offline'
            ? 'built-in engine'
            : state.settings.provider.model || 'http provider'}
        </span>
        <span className="status-kbd">
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>E</kbd> expand · <kbd>F</kbd> fit ·{' '}
          <kbd>Ctrl</kbd>+<kbd>F</kbd> search · double-click a node
        </span>
      </footer>

      {/* ---------------- overlays ---------------- */}
      <ModalHost store={store} />

      {state.compare && (
        <div
          className="toast toast-amber"
          style={{ position: 'fixed', bottom: 44, right: 360, zIndex: 55 }}
        >
          ⇄ Comparing branches — see the inspector
          <button className="btn btn-sm btn-ghost" onClick={() => store.setCompare(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="toast-stack">
        {state.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === 'error' ? 'toast-rose' : t.kind === 'success' ? 'toast-cyan' : ''}`}
          >
            {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : '·'} {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
