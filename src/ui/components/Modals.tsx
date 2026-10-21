/**
 * Modal layer: new universe, import, export, provider settings, library,
 * counterfactual creation and about.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { PROVIDER_PRESETS, type ProviderSettings } from '../../ai/provider';
import { IMPORT_LIMITS } from '../../core/validate';
import { APP_VERSION } from '../../core/importExport';
import { formatValue } from '../../core/vars';
import { ShortcutsModal } from './ShortcutsModal';
import { UpdateSection } from './UpdateSection';
import { startTour } from '../tour';

/** Everything a keyboard can reach, in the order the eye would reach it. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalHost({ store }: { store: Store }) {
  const state = useAppState(store);
  const modal = state.modal;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const kind = modal?.kind ?? null;

  /**
   * Remembers the control that opened the dialog.
   *
   * The dialog cannot work this out for itself when it opens: a child of the
   * dialog may focus itself on mount, and child effects run before parent
   * ones, so by the time the parent looks, the focus has already moved
   * inside. The store tells us the moment a dialog is opened — before React
   * has rendered any of it — so the focus is still where the person left it.
   */
  useEffect(() => {
    wasOpenRef.current = store.getState().modal !== null;
    return store.subscribe(() => {
      const isOpen = store.getState().modal !== null;
      if (isOpen && !wasOpenRef.current) {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) triggerRef.current = active;
      }
      wasOpenRef.current = isOpen;
    });
  }, [store]);

  /**
   * Focus goes into the dialog when it opens and back to whatever opened it
   * when it closes. Without this, a keyboard user is left tabbing through the
   * page behind the dialog, which is the single most common way an app
   * becomes unusable without a mouse.
   */
  useEffect(() => {
    if (!kind) return;
    const node = dialogRef.current;
    // Prefer the first field a person would want to type into, then the first
    // control in the body, then anything at all. The close button in the
    // header is a poor place to land.
    const body = node?.querySelector('.modal-body');
    const target =
      body?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      ) ??
      body?.querySelector<HTMLElement>(FOCUSABLE) ??
      node?.querySelector<HTMLElement>(FOCUSABLE) ??
      node;
    target?.focus();
    return () => {
      triggerRef.current?.focus?.();
    };
  }, [kind]);

  if (!modal) return null;
  const close = (): void => store.openModal(null);

  /** Keeps Tab inside the dialog while it is open. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (items.length === 0) {
      e.preventDefault();
      node.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {modal.kind === 'new' && <NewUniverse store={store} close={close} />}
        {modal.kind === 'import' && <ImportModal store={store} close={close} />}
        {modal.kind === 'export' && <ExportModal store={store} close={close} />}
        {modal.kind === 'settings' && <SettingsModal store={store} close={close} />}
        {modal.kind === 'library' && <LibraryModal store={store} close={close} />}
        {modal.kind === 'counterfactual' && (
          <CounterfactualModal store={store} close={close} assumptionId={modal.assumptionId} />
        )}
        {modal.kind === 'about' && <AboutModal store={store} close={close} />}
        {modal.kind === 'shortcuts' && <ShortcutsModal store={store} close={close} />}
        {modal.kind === 'compare' && <CompareModal store={store} close={close} />}
      </div>
    </div>
  );
}

function Head({ title, close, hint }: { title: string; close: () => void; hint?: string }) {
  return (
    <div className="modal-head">
      <h2 className="modal-title" id="modal-title">
        {title}
      </h2>
      {hint && <span className="chip">{hint}</span>}
      <button className="btn btn-ghost btn-sm" onClick={close} aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/**
 * A labelled on/off switch.
 *
 * The label is written once and used for both the visible text and the
 * button's accessible name, so the two cannot drift apart.
 */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New universe                                                        */
/* ------------------------------------------------------------------ */

const SUGGESTIONS = [
  'I got an offer to move abroad for a job I am not sure I want.',
  'Should I quit my job to build my own product for a year?',
  'I am 34 and thinking about going back to university.',
  'We are deciding whether to buy a flat or keep renting.',
  'Should I end a stable relationship to travel for a year?',
];

function NewUniverse({ store, close }: { store: Store; close: () => void }) {
  const [situation, setSituation] = useState('');
  const [decision, setDecision] = useState('');
  const [goals, setGoals] = useState('');
  const [horizon, setHorizon] = useState(36);
  const [imagination, setImagination] = useState(0.45);
  const [branchCount, setBranchCount] = useState(3);

  const valid = situation.trim().length >= 8 && decision.trim().length >= 4;

  const submit = (): void => {
    if (!valid) return;
    store.newUniverse({ situation, decision, goals, horizon, imagination, branchCount });
    close();
  };

  return (
    <>
      <Head title="New universe" close={close} hint="offline rules engine" />
      <div className="modal-body">
        <div className="hero">
          <div className="hero-title">What is the fork in the road?</div>
          <div className="hero-sub">
            Describe where you are and the decision in front of you. The built-in rules engine
            builds a deterministic branching simulation — no network, no account, no invented
            probabilities. You can hand it to an AI provider later if you want richer prose.
          </div>

          <label className="field">
            <span className="field-label">Situation</span>
            <textarea
              className="textarea"
              value={situation}
              autoFocus
              placeholder="I have been working in ops for six years, have 14k saved, and live in a city where my rent keeps rising…"
              onChange={(e) => setSituation(e.target.value)}
            />
          </label>

          <div className="suggest-row">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggest" onClick={() => setSituation(s)}>
                {s.slice(0, 52)}…
              </button>
            ))}
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            <span className="field-label">The decision</span>
            <input
              className="input"
              value={decision}
              placeholder="Should I take the overseas offer?"
              onChange={(e) => setDecision(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) submit();
              }}
            />
          </label>

          <label className="field">
            <span className="field-label">Goals (comma separated)</span>
            <input
              className="input"
              value={goals}
              placeholder="financial stability, mastery, time outdoors"
              onChange={(e) => setGoals(e.target.value)}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label className="field">
              <span className="field-label">Horizon</span>
              <select
                className="select"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              >
                <option value={12}>12 months</option>
                <option value={24}>24 months</option>
                <option value={36}>36 months</option>
                <option value={60}>5 years</option>
                <option value={120}>10 years</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Branches</span>
              <select
                className="select"
                value={branchCount}
                onChange={(e) => setBranchCount(Number(e.target.value))}
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} paths
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Imagination {Math.round(imagination * 100)}%</span>
              <input
                className="range"
                type="range"
                min={0}
                max={100}
                value={Math.round(imagination * 100)}
                onChange={(e) => setImagination(Number(e.target.value) / 100)}
                style={{ width: '100%', marginTop: 6 }}
                aria-label="Imagination"
              />
              <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                grounded ← → speculative
              </span>
            </label>
          </div>
        </div>

        {!valid && (
          <div className="note" style={{ marginTop: 12 }}>
            Give the engine at least a sentence of situation and a short decision to work with.
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>
          Create universe →
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

function ImportModal({ store, close }: { store: Store; close: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const useText = (): void => {
    if (store.importText(text)) close();
  };

  const pickFile = async (): Promise<void> => {
    setError(null);
    try {
      if (window.whatifs) {
        const picked = await window.whatifs.openFile([
          { name: 'What If? universe', extensions: ['whatif.json', 'json'] },
        ]);
        if (!picked) return;
        if (store.importText(picked.text)) close();
        return;
      }
      // browser fallback: file input handled by the hidden input below
      fileInputRef.current?.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <Head
        title="Import universe"
        close={close}
        hint={`max ${Math.round(IMPORT_LIMITS.maxBytes / 1024)} KB`}
      />
      <div className="modal-body">
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn btn-primary" onClick={() => void pickFile()}>
            Open file…
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)', alignSelf: 'center' }}>
            or paste the exported JSON below
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.whatif.json,application/json"
          aria-label="Choose a universe file to import"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const t = await file.text();
            setText(t);
            e.target.value = '';
          }}
        />
        <textarea
          className="textarea"
          aria-label="Paste a universe file"
          style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          placeholder="{ … }"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && (
          <div className="note" style={{ marginTop: 8, borderLeftColor: 'var(--rose)' }}>
            {error}
          </div>
        )}
        <div className="note" style={{ marginTop: 10 }}>
          Imports are validated strictly: malformed JSON or structurally broken graphs are rejected
          with the exact reason. Dangling edges and unreachable nodes are repaired automatically and
          the repairs are reported back to you.
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={text.trim().length === 0} onClick={useText}>
          Import →
        </button>
      </div>
    </>
  );
}

function ExportModal({ store, close }: { store: Store; close: () => void }) {
  const text = store.exportText();
  const name = store.exportName();
  const [note, setNote] = useState<string | null>(null);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied to clipboard.');
    } catch {
      setNote('Clipboard blocked — use Save file instead.');
    }
  };

  const save = async (): Promise<void> => {
    try {
      if (window.whatifs) {
        const path = await window.whatifs.saveFile(name, text, [
          { name: 'What If? universe', extensions: ['whatif.json'] },
        ]);
        setNote(path ? `Saved to ${path}` : 'Save cancelled.');
        return;
      }
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setNote('Downloaded.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Head title="Export universe" close={close} hint={name} />
      <div className="modal-body">
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save file…
          </button>
          <button className="btn" onClick={() => void copy()}>
            Copy JSON
          </button>
          {note && (
            <span style={{ fontSize: 11.5, color: 'var(--cyan)', alignSelf: 'center' }}>
              {note}
            </span>
          )}
        </div>
        <pre className="code-block">{text}</pre>
        <div className="note" style={{ marginTop: 10 }}>
          The envelope carries <strong>format: whatif.universe</strong>, a format version and the
          schema version, so future releases can migrate this file. The document itself is fully
          self-contained: graph, layout, assumptions, prompt and provenance.
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function SettingsModal({ store, close }: { store: Store; close: () => void }) {
  const state = useAppState(store);
  const [draft, setDraft] = useState<ProviderSettings>({ ...state.settings.provider });
  const [secret, setSecret] = useState('');
  const [secretState, setSecretState] = useState<'unknown' | 'set' | 'missing'>('unknown');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    if (window.whatifs) {
      window.whatifs.getSecret('whatifs:http').then((v) => {
        if (alive) setSecretState(v ? 'set' : 'missing');
      });
    } else setSecretState('missing');
    return () => {
      alive = false;
    };
  }, []);

  const patch = (p: Partial<ProviderSettings>): void => setDraft((d) => ({ ...d, ...p }));

  const save = async (): Promise<void> => {
    if (window.whatifs && secret.trim()) {
      const ok = await window.whatifs.setSecret('whatifs:http', secret.trim());
      if (!ok) {
        setSaved(false);
        return;
      }
      setSecret('');
      setSecretState('set');
    }
    store.setSettings({ provider: { ...draft, apiKey: undefined } });
    setSaved(true);
    window.setTimeout(close, 450);
  };

  return (
    <>
      <Head title="Settings" close={close} />
      <div className="modal-body">
        <div className="section">
          <h3 className="section-title">Generation provider</h3>
          <label className="field">
            <span className="field-label">Provider</span>
            <select
              className="select"
              value={draft.id}
              onChange={(e) => {
                const id = e.target.value as ProviderSettings['id'];
                const preset = PROVIDER_PRESETS.find((p) => p.id === id);
                patch({ id, label: preset ? preset.label : 'Built-in engine' });
                if (preset)
                  patch({ id, label: preset.label, baseUrl: preset.baseUrl, model: preset.model });
                if (id === 'offline')
                  patch({ id, label: 'Built-in engine', baseUrl: '', model: '' });
              }}
            >
              <option value="offline">Built-in engine (offline, always works)</option>
              <option value="openai-compatible">OpenAI-compatible HTTP endpoint</option>
            </select>
          </label>

          {draft.id !== 'offline' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="field">
                  <span className="field-label">Base URL</span>
                  <input
                    className="input"
                    value={draft.baseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) => patch({ baseUrl: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Model</span>
                  <input
                    className="input"
                    value={draft.model}
                    placeholder="gpt-4o-mini / llama3.1"
                    onChange={(e) => patch({ model: e.target.value })}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">
                  API key{' '}
                  {secretState === 'set'
                    ? '· stored in Windows credential vault'
                    : secretState === 'missing'
                      ? '· none stored'
                      : ''}
                </span>
                <input
                  className="input"
                  type="password"
                  value={secret}
                  placeholder={
                    secretState === 'set'
                      ? '••••••••  (enter to replace)'
                      : 'sk-… (optional for local servers)'
                  }
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                />
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                  Saved through Electron <code>safeStorage</code> in the main process — never
                  written to the renderer, logs or exported files. Leave blank to keep the stored
                  one.
                </span>
              </label>

              <Switch
                label="Keyless endpoint (Ollama, llama.cpp, LM Studio)"
                checked={draft.keyless}
                onChange={() => patch({ keyless: !draft.keyless })}
              />
              <Switch
                label="Strict — fail instead of falling back to the built-in engine"
                checked={draft.strict}
                onChange={() => patch({ strict: !draft.strict })}
              />
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}
              >
                <label className="field">
                  <span className="field-label">Timeout (ms)</span>
                  <input
                    className="input"
                    type="number"
                    min={1000}
                    max={120000}
                    step={1000}
                    value={draft.timeoutMs}
                    onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Max tokens</span>
                  <input
                    className="input"
                    type="number"
                    min={256}
                    max={8192}
                    step={256}
                    value={draft.maxTokens}
                    onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                  />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="section">
          <h3 className="section-title">Appearance & feedback</h3>
          <Switch
            label="Reduced motion (no growth animations, instant transitions)"
            checked={state.settings.reducedMotion}
            onChange={() => store.setSettings({ reducedMotion: !state.settings.reducedMotion })}
          />
          <Switch
            label="Minimap"
            checked={state.settings.showMinimap}
            onChange={() => store.setSettings({ showMinimap: !state.settings.showMinimap })}
          />
          <Switch
            label="Canvas grid"
            checked={state.settings.showGrid}
            onChange={() => store.setSettings({ showGrid: !state.settings.showGrid })}
          />
          <Switch
            label="State chips on node cards"
            checked={state.settings.showSpread}
            onChange={() => store.setSettings({ showSpread: !state.settings.showSpread })}
          />
        </div>

        <div className="section">
          <h3 className="section-title">Updates</h3>
          <UpdateSection />
        </div>

        <div className="note">
          This app never sends anything anywhere unless you configure a provider above. No
          telemetry, no crash reporting, no accounts. Saved universes live in this machine’s app
          data.
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          {saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

function LibraryModal({ store, close }: { store: Store; close: () => void }) {
  const state = useAppState(store);
  useEffect(() => store.refreshLibrary(), [store]);

  return (
    <>
      <Head title="Library" close={close} hint={`${state.library.length} saved`} />
      <div className="modal-body">
        {state.library.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Nothing saved yet</div>
            Universes you create, fork or import are listed here automatically.
          </div>
        ) : (
          <div className="node-list">
            {state.library.map((s) => (
              <div
                key={s.id}
                className="variant-card"
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="variant-title"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {s.title}
                  </div>
                  <div className="variant-sub">
                    {s.nodeCount} nodes · {s.branchCount} branches ·{' '}
                    {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                {s.isCounterfactual && <span className="chip chip-violet">counterfactual</span>}
                <span className={`chip ${s.generator === 'ai' ? 'chip-violet' : 'chip-cyan'}`}>
                  {s.generator === 'ai' ? 'ai' : 'offline'}
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    store.openFromLibrary(s.id);
                    close();
                  }}
                >
                  Open
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => store.deleteFromLibrary(s.id)}
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Counterfactual                                                      */
/* ------------------------------------------------------------------ */

function CounterfactualModal({
  store,
  close,
  assumptionId,
}: {
  store: Store;
  close: () => void;
  assumptionId: string;
}) {
  const state = useAppState(store);
  const assumption = state.doc.assumptions.find((a) => a.id === assumptionId);
  const [value, setValue] = useState(assumption?.value ?? 0);
  const [note, setNote] = useState('');

  if (!assumption) {
    return (
      <>
        <Head title="What if…" close={close} />
        <div className="modal-body">
          <div className="empty">That assumption no longer exists.</div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={close}>
            Close
          </button>
        </div>
      </>
    );
  }

  const step = assumption.unit === 'percent' ? 5 : assumption.unit === 'currency' ? 500 : 1;
  const lo = Math.min(assumption.baseValue, assumption.value) - step * 10;
  const hi = Math.max(assumption.baseValue, assumption.value) + step * 10;

  const create = (): void => {
    const doc = store.makeCounterfactual(
      assumption.id,
      value,
      note.trim() || `Set ${assumption.label} to ${formatValue(value, assumption.unit)}`
    );
    if (doc) close();
  };

  return (
    <>
      <Head
        title={`What if ${assumption.label.toLowerCase()} changed?`}
        close={close}
        hint="forks the universe"
      />
      <div className="modal-body">
        <div className="note">
          <strong>Now:</strong> {formatValue(assumption.value, assumption.unit)} (base{' '}
          {formatValue(assumption.baseValue, assumption.unit)})<br />
          {assumption.rationale}
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="range-row">
            <input
              className="range"
              type="range"
              min={lo}
              max={hi}
              step={step}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              aria-label={assumption.label}
            />
            <span className="range-value">{formatValue(value, assumption.unit)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10.5,
              color: 'var(--text-faint)',
              marginTop: 4,
            }}
          >
            <span>{formatValue(lo, assumption.unit)}</span>
            <span>influence {Math.round(assumption.sensitivity * 100)}%</span>
            <span>{formatValue(hi, assumption.unit)}</span>
          </div>
        </div>

        <label className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Why this change? (recorded in lineage)</span>
          <input
            className="input"
            value={note}
            placeholder="e.g. I could negotiate a relocation package"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="note note-violet">
          This creates a <strong>new universe document</strong> derived from the current one — the
          original stays untouched, and both are comparable in the branch diff. The change is
          re-simulated through the rule engine, not relabelled.
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-violet" onClick={create}>
          Create counterfactual →
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Compare two paths                                                   */
/* ------------------------------------------------------------------ */

function CompareModal({ store, close }: { store: Store; close: () => void }) {
  const state = useAppState(store);
  const branches = store.comparableBranches();
  const current = state.diffBranches;

  const [a, setA] = useState(current?.a ?? branches[0]?.id ?? '');
  const [b, setB] = useState(
    current?.b ?? branches.find((x) => x.id !== (current?.a ?? branches[0]?.id))?.id ?? ''
  );

  if (branches.length < 2) {
    return (
      <>
        <Head title="Compare two paths" close={close} />
        <div className="modal-body">
          <div className="empty">
            <div className="empty-title">Not enough paths yet</div>
            This universe has {branches.length === 0 ? 'no paths' : 'only one path'}. Expand a step
            to create more, then come back.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={close}>
            Close
          </button>
        </div>
      </>
    );
  }

  const valid = a !== '' && b !== '' && a !== b;

  const swap = (): void => {
    setA(b);
    setB(a);
  };

  const compare = (): void => {
    if (!valid) return;
    store.setDiffBranches({ a, b });
    store.setViewMode('diff');
    close();
  };

  return (
    <>
      <Head title="Compare two paths" close={close} hint={`${branches.length} paths`} />
      <div className="modal-body">
        <div className="hero" style={{ marginBottom: 14 }}>
          <div className="hero-title">Which two do you want to see side by side?</div>
          <div className="hero-sub">
            The comparison lines each path up against the other, shows where they part company, and
            lists what ends up different. It does not tell you which to choose.
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <label className="field">
            <span className="field-label">First path</span>
            <select className="select" value={a} onChange={(e) => setA(e.target.value)}>
              {branches.map((br) => (
                <option key={br.id} value={br.id}>
                  {br.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost" onClick={swap} aria-label="Swap the two paths">
            ⇄
          </button>
          <label className="field">
            <span className="field-label">Second path</span>
            <select className="select" value={b} onChange={(e) => setB(e.target.value)}>
              {branches.map((br) => (
                <option key={br.id} value={br.id}>
                  {br.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {a === b && a !== '' && (
          <div className="note" style={{ marginTop: 12, borderLeftColor: 'var(--amber)' }}>
            Pick two different paths to compare.
          </div>
        )}

        <div className="note" style={{ marginTop: 12 }}>
          Both paths are projected to the end of the horizon before they are compared, so the
          difference you see is a difference in the path and not in the timing.
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={compare}>
          Compare →
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

function AboutModal({ store, close }: { store: Store; close: () => void }) {
  const state = useAppState(store);
  return (
    <>
      <Head title="About" close={close} />
      <div className="modal-body">
        <div className="hero">
          <div className="hero-title">WHAT IF? — The Infinite Lives Engine</div>
          <div className="hero-sub">
            Version {APP_VERSION} · schema v{state.doc.schemaVersion} ·{' '}
            {state.doc.meta.generator === 'ai' ? 'AI-assisted' : 'Built-in rules engine'}
          </div>
          <div className="btn-row">
            <span className="chip chip-cyan">{state.doc.meta.providerLabel}</span>
            {state.doc.meta.modelLabel && (
              <span className="chip chip-violet">{state.doc.meta.modelLabel}</span>
            )}
            <span className="chip">seed {state.doc.seed}</span>
            <span className="chip">{state.doc.id}</span>
          </div>
        </div>

        <div className="section" style={{ marginTop: 14 }}>
          <h3 className="section-title">Provenance</h3>
          <div className="note">{state.doc.meta.provenance}</div>
        </div>

        <div className="section">
          <h3 className="section-title">Honesty contract</h3>
          <div className="note note-violet">
            Every number in this app is produced by a deterministic rule engine over your stated
            assumptions. Model spread is engine variance, clearly labelled — never presented as
            real-world probabilities. Evidence tags separate what you told the model from what it
            assumed or speculated.
          </div>
        </div>

        <div className="section">
          <h3 className="section-title">Privacy</h3>
          <div className="note">
            Local-first. No telemetry, no analytics, no crash reporting, no accounts. Network access
            happens only if you configure an HTTP provider yourself.
          </div>
        </div>

        <div className="section">
          <h3 className="section-title">Help</h3>
          <div className="note">
            The introduction explains what the graph means and how to read it. It is worth two
            minutes if this is your first time here.
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                close();
                window.dispatchEvent(new Event('whatifs:show-orientation'));
              }}
            >
              Show the introduction
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                close();
                startTour();
              }}
            >
              Walk through the controls
            </button>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>
          Close
        </button>
      </div>
    </>
  );
}
