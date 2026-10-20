/**
 * Right panel: node inspector, state readout, evidence, decisions, path
 * explanation, forecasts, sensitivity and the comparison view.
 */
import { useMemo, useState } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { NODE_TYPE_LABEL, EVIDENCE_LABEL, type EvidenceClass } from '../../core/types';
import { formatDelta, formatValue, isBetter } from '../../core/vars';

const EVIDENCE_CHIP: Record<EvidenceClass, string> = {
  'user-fact': 'chip-cyan',
  research: 'chip-violet',
  assumption: 'chip-amber',
  speculation: 'chip-rose',
};

export function Inspector({ store }: { store: Store }) {
  const state = useAppState(store);
  const node = state.selected ? state.doc.nodes[state.selected] : undefined;
  const [showPath, setShowPath] = useState(false);
  const [forecast, setForecast] = useState<Record<string, number> | null>(null);
  const [spreadKey, setSpreadKey] = useState<string | null>(null);
  const [comparePick, setComparePick] = useState('');

  const primaryVars = useMemo(
    () => state.doc.vars.filter((v) => v.primary).slice(0, 8),
    [state.doc.vars]
  );

  if (!node) {
    return (
      <aside className="panel panel-right">
        <div className="panel-head">
          <span className="panel-title">Inspector</span>
        </div>
        <div className="panel-body">
          <div className="empty">
            <div className="empty-title">No node selected</div>
            Click a node on the canvas — or search for one on the left — to inspect its state,
            evidence and consequences.
          </div>
        </div>
      </aside>
    );
  }

  const branch = state.doc.branches[node.branch];
  const typeChip =
    node.type === 'start'
      ? 'chip-cyan'
      : node.type === 'decision'
        ? 'chip-amber'
        : node.type === 'setback'
          ? 'chip-rose'
          : node.type === 'opportunity' || node.type === 'milestone'
            ? 'chip-green'
            : node.type === 'ending'
              ? 'chip-violet'
              : 'chip-violet';

  const spreadVar = state.doc.vars.find((v) => node.state && v.key in node.state);
  const spread = spreadKey || spreadVar?.key || null;
  const spreadResult = spread ? store.spreadFor(node.id, spread) : null;
  const why = showPath ? store.explainPath() : [];
  const forecastVars =
    forecast && node.state
      ? Object.entries(forecast)
          .filter(([k]) => k in (node.state ?? {}))
          .slice(0, 6)
      : [];

  return (
    <aside className="panel panel-right">
      <div className="panel-head">
        <span className="panel-title">Inspector</span>
        <span className="spacer" />
        <span className={`chip ${typeChip}`}>{NODE_TYPE_LABEL[node.type]}</span>
      </div>

      <div className="panel-body">
        {/* ---------- identity ---------- */}
        <div className="section">
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {node.title}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
            <span
              className="chip"
              style={{
                borderColor: `hsl(${branch?.hue ?? 200} 70% 55%)`,
                color: `hsl(${branch?.hue ?? 200} 70% 70%)`,
              }}
            >
              {branch?.name ?? node.branch}
            </span>
            <span className="chip">{node.horizon}</span>
            <span className="chip">t = {node.t} mo</span>
            <span className="chip">depth {node.depth}</span>
            {node.expanded && <span className="chip chip-green">expanded</span>}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 9, lineHeight: 1.6 }}>
            {node.summary}
          </p>
          {node.detail && (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.6 }}>
              {node.detail}
            </p>
          )}
        </div>

        {/* ---------- user notes ---------- */}
        <div className="section">
          <h3 className="section-title">Notes</h3>
          <textarea
            className="textarea"
            placeholder="Your thoughts about this node (markdown supported)..."
            value={node.userNotes ?? ''}
            onChange={(e) => store.setNodeNotes(node.id, e.target.value)}
            style={{ minHeight: 100, fontSize: 11.5, lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4 }}>
            Saved automatically as part of your universe.
          </div>
        </div>

        {/* ---------- actions ---------- */}
        <div className="section">
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => store.expandNode(node.id)}
              disabled={!node.expandable || node.expanded}
              title={
                node.expanded
                  ? 'Already expanded'
                  : node.expandable
                    ? 'Generate the next steps on this branch'
                    : 'No further steps from a future state'
              }
            >
              ⤢ Expand
            </button>
            <button className="btn btn-violet" onClick={() => setShowPath((v) => !v)}>
              {showPath ? 'Hide' : '⟂'} Why this path?
            </button>
            <button className="btn btn-ghost" onClick={() => store.centerOn(node.id)}>
              ◎ Center
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  const { exportPathAsMarkdown, downloadMarkdown } =
                    await import('../utils/exportPath');
                  const md = exportPathAsMarkdown(state.doc, node.id);
                  downloadMarkdown(md, state.doc.title);
                  store.toast('Path exported as Markdown', 'success');
                } catch {
                  store.toast('Failed to export path', 'error');
                }
              }}
              title="Export this path as Markdown report"
            >
              📄 Export path
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <select
              className="select"
              style={{ flex: 1, minWidth: 140 }}
              value={comparePick}
              onChange={(e) => setComparePick(e.target.value)}
              aria-label="Node to compare with"
            >
              <option value="">Compare with…</option>
              {Object.values(state.doc.nodes)
                .filter((n) => n.id !== node.id && n.state)
                .sort((a, b) => a.depth - b.depth || a.t - b.t)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
            <button
              className="btn btn-amber"
              disabled={!comparePick}
              onClick={() => {
                if (comparePick) store.compareWith(comparePick);
              }}
            >
              ⇄ Compare
            </button>
          </div>
        </div>

        {/* ---------- path explanation ---------- */}
        {showPath && (
          <div className="section">
            <h3 className="section-title">Why this path</h3>
            <div className="note note-violet">
              {why.length === 0 ? (
                'No causal chain recorded for this node.'
              ) : (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {why.map((r, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>
                      {r}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* ---------- state ---------- */}
        {node.state && (
          <div className="section">
            <h3 className="section-title">State at this node</h3>
            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {primaryVars.map((v) => {
                const value = node.state?.[v.key];
                if (value === undefined) return null;
                const deltaEntry = node.delta?.find((d) => d.key === v.key);
                const delta = deltaEntry ? deltaEntry.after - deltaEntry.before : 0;
                const good = delta === 0 ? null : isBetter(delta, v);
                return (
                  <div className="metric metric-cyan" key={v.key}>
                    <div className="metric-label">{v.label}</div>
                    <div className="metric-value">{formatValue(value, v.unit)}</div>
                    {deltaEntry && Math.abs(delta) > 1e-9 && (
                      <div
                        className={`metric-sub ${good === null ? '' : good ? 'delta-up' : 'delta-down'}`}
                      >
                        {formatDelta(delta, v.unit)} · {deltaEntry.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- forecast & spread ---------- */}
        {node.state && (
          <div className="section">
            <h3 className="section-title">Model outlook</h3>
            <div className="btn-row">
              <button
                className="btn btn-sm"
                onClick={() => setForecast(store.forecastFor(node.id, 12))}
              >
                Forecast +12 mo
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setForecast(store.forecastFor(node.id, 36))}
              >
                Forecast +36 mo
              </button>
              {forecast && (
                <button className="btn btn-sm btn-ghost" onClick={() => setForecast(null)}>
                  clear
                </button>
              )}
            </div>

            {forecast && (
              <div style={{ marginTop: 8 }}>
                {forecastVars.length === 0 ? (
                  <div className="note">No forecastable state on this node.</div>
                ) : (
                  forecastVars.map(([k, v]) => {
                    const def = state.doc.vars.find((x) => x.key === k);
                    const now = node.state?.[k] ?? 0;
                    const diff = v - now;
                    if (!def) return null;
                    return (
                      <div className="bar-row" key={k}>
                        <span className="bar-label">{def.label}</span>
                        <span className="bar-track" style={{ background: 'transparent' }}>
                          <span
                            className={`bar-fill ${Math.abs(diff) < 1e-6 ? 'delta-flat' : isBetter(diff, def) ? 'delta-up' : 'delta-down'}`}
                            style={{
                              width: '100%',
                              background: 'transparent',
                              fontSize: 10.5,
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {formatValue(v, def.unit)} ({formatDelta(diff, def.unit)})
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {spreadVar && (
              <div style={{ marginTop: 8 }}>
                <select
                  className="select"
                  value={spread ?? ''}
                  onChange={(e) => setSpreadKey(e.target.value)}
                  aria-label="Metric for model spread"
                >
                  {state.doc.vars
                    .filter((v) => node.state && v.key in node.state)
                    .map((v) => (
                      <option key={v.key} value={v.key}>
                        Spread: {v.label}
                      </option>
                    ))}
                </select>
                {spreadResult ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="bar-row">
                      <span className="bar-label">p10 · p50 · p90</span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--cyan)',
                        }}
                      >
                        {spreadResult.p10} · {spreadResult.p50} · {spreadResult.p90}
                      </span>
                    </div>
                    <div className="note" style={{ fontSize: 11 }}>
                      Model spread across {spreadResult.samples} seeded re-runs of the rule engine —
                      this is engine variance, not a real-world probability.
                    </div>
                  </div>
                ) : (
                  <div className="note" style={{ marginTop: 6 }}>
                    Not enough downstream rules to estimate spread.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- decision ---------- */}
        {node.decision && (
          <div className="section">
            <h3 className="section-title">Decision here</h3>
            <div className="note note-amber">
              <strong>{node.decision.question}</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              {node.decision.options.map((o) => (
                <button
                  key={o.id}
                  className="variant-card"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => store.chooseOption(o.id)}
                  title="Creates a counterfactual universe where this option was chosen"
                >
                  <div className="variant-title">{o.label}</div>
                  <div className="variant-meta">
                    <span className="chip chip-amber">choose → new universe</span>
                    {o.leadsTo && <span className="chip">already taken in this universe</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------- trade-offs ---------- */}
        {node.tradeoffs && (node.tradeoffs.gains.length > 0 || node.tradeoffs.costs.length > 0) && (
          <div className="section">
            <h3 className="section-title">Trade-offs</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="note" style={{ borderLeftColor: 'rgba(92,230,168,0.6)' }}>
                <strong>Gains</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {node.tradeoffs.gains.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
              <div className="note note-amber">
                <strong>Costs</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {node.tradeoffs.costs.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ---------- evidence ---------- */}
        {node.evidence.length > 0 && (
          <div className="section">
            <h3 className="section-title">Evidence</h3>
            <div className="tag-row">
              {node.evidence.map((t, i) => (
                <span
                  key={i}
                  className={`chip ${EVIDENCE_CHIP[t.cls]}`}
                  title={t.source ?? EVIDENCE_LABEL[t.cls]}
                >
                  {EVIDENCE_LABEL[t.cls]}: {t.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ---------- assumptions / uncertainties ---------- */}
        {(node.assumptions.length > 0 || node.uncertainties.length > 0) && (
          <div className="section">
            {node.assumptions.length > 0 && (
              <>
                <h3 className="section-title">Rests on</h3>
                <div className="tag-row" style={{ marginBottom: 8 }}>
                  {node.assumptions.map((a, i) => (
                    <span key={i} className="chip chip-amber">
                      {a}
                    </span>
                  ))}
                </div>
              </>
            )}
            {node.uncertainties.length > 0 && (
              <>
                <h3 className="section-title">Uncertain because</h3>
                <div className="tag-row">
                  {node.uncertainties.map((u, i) => (
                    <span key={i} className="chip chip-rose">
                      {u}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------- failure points / next steps / resources ---------- */}
        {((node.failurePoints?.length ?? 0) > 0 ||
          (node.nextSteps?.length ?? 0) > 0 ||
          (node.resources?.length ?? 0) > 0) && (
          <div className="section">
            {node.failurePoints && node.failurePoints.length > 0 && (
              <>
                <h3 className="section-title">Failure points</h3>
                <div className="note note-amber" style={{ marginBottom: 8 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {node.failurePoints.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {node.nextSteps && node.nextSteps.length > 0 && (
              <>
                <h3 className="section-title">Next steps</h3>
                <div className="note" style={{ marginBottom: 8 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {node.nextSteps.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {node.resources && node.resources.length > 0 && (
              <>
                <h3 className="section-title">Resources involved</h3>
                <div className="tag-row">
                  {node.resources.map((f, i) => (
                    <span key={i} className="chip">
                      {f}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------- assumptions of the universe ---------- */}
        <div className="section">
          <h3 className="section-title">Universe assumptions</h3>
          {state.doc.assumptions.map((a) => (
            <AssumptionRow
              key={a.id}
              assumption={a}
              onPreview={(v) => store.previewAssumption(a.id, v)}
              onCommit={(v) => store.commitAssumption(a.id, v)}
              onWhatIf={() => store.openModal({ kind: 'counterfactual', assumptionId: a.id })}
            />
          ))}
        </div>

        {/* ---------- comparison ---------- */}
        {state.compare && <Comparison store={store} />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function AssumptionRow({
  assumption,
  onPreview,
  onCommit,
  onWhatIf,
}: {
  assumption: {
    id: string;
    label: string;
    varKey: string;
    unit: import('../../core/types').VarUnit;
    baseValue: number;
    value: number;
    rationale: string;
    sensitivity: number;
    editable: boolean;
  };
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  onWhatIf: () => void;
}) {
  const [local, setLocal] = useState(assumption.value);
  const step =
    assumption.unit === 'percent'
      ? 5
      : assumption.unit === 'currency'
        ? 500
        : assumption.unit === 'months'
          ? 1
          : 1;
  const changed = Math.abs(local - assumption.baseValue) > 1e-9;

  return (
    <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed var(--line)' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{assumption.label}</span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: changed ? 'var(--amber)' : 'var(--text-faint)',
          }}
        >
          {formatValue(assumption.value, assumption.unit)}
          {changed && (
            <span style={{ color: 'var(--text-faint)' }}>
              {' '}
              (base {formatValue(assumption.baseValue, assumption.unit)})
            </span>
          )}
        </span>
      </div>
      <div className="range-row" style={{ marginTop: 5 }}>
        <input
          className="range"
          type="range"
          min={Math.min(assumption.baseValue, assumption.value) - step * 10}
          max={Math.max(assumption.baseValue, assumption.value) + step * 10}
          step={step}
          value={local}
          disabled={!assumption.editable}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal(v);
            onPreview(v);
          }}
          onPointerUp={() => onCommit(local)}
          onKeyUp={() => onCommit(local)}
          aria-label={assumption.label}
        />
        <button
          className="btn btn-sm btn-violet"
          onClick={onWhatIf}
          title="Fork this universe with this assumption changed"
        >
          What if…
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-faint)', lineHeight: 1.45 }}>
          {assumption.rationale}
        </span>
        <span
          className="chip chip-cyan"
          style={{ flex: '0 0 auto' }}
          title="Model-derived influence on headline outcomes"
        >
          sens {Math.round(assumption.sensitivity * 100)}%
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Comparison({ store }: { store: Store }) {
  const state = useAppState(store);
  const cmp = state.compare;
  if (!cmp) return null;

  const vars = state.doc.vars;
  const stat = (keys: string[], label: string, cls: string): string | null =>
    keys.length === 0
      ? null
      : `${label}: ${keys.length} ${cls} (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''})`;

  return (
    <div
      className="section"
      style={{ border: '1px solid var(--amber-dim)', borderRadius: 'var(--r)', padding: 10 }}
    >
      <h3 className="section-title" style={{ color: 'var(--amber)' }}>
        Comparison
      </h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="chip chip-cyan" title={cmp.a.title}>
          {cmp.a.title}
        </span>
        <span style={{ color: 'var(--text-faint)' }}>→</span>
        <span className="chip chip-amber" title={cmp.b.title}>
          {cmp.b.title}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => store.setCompare(null)}>
          ✕ close
        </button>
      </div>

      <table className="cmp-table">
        <thead>
          <tr>
            <th>Variable</th>
            <th style={{ textAlign: 'right' }}>A</th>
            <th style={{ textAlign: 'right' }}>B</th>
            <th style={{ textAlign: 'right' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {cmp.diffs.map((d) => {
            const def = vars.find((v) => v.key === d.key);
            const good = def ? isBetter(d.delta, def) : d.delta >= 0;
            return (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{formatValue(d.from, d.unit)}</td>
                <td className="num">{formatValue(d.to, d.unit)}</td>
                <td
                  className={`num ${Math.abs(d.delta) < 1e-6 ? 'delta-flat' : good ? 'delta-up' : 'delta-down'}`}
                >
                  {formatDelta(d.delta, d.unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          stat(cmp.stability.stable, 'stable', ''),
          stat(cmp.stability.moved, 'moved', ''),
          stat(cmp.stability.sensitive, 'noise-sensitive', ''),
        ]
          .filter((x): x is string => x !== null)
          .map((s) => (
            <span key={s} style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {s}
            </span>
          ))}
      </div>
      <div className="note" style={{ marginTop: 8, fontSize: 11 }}>
        Variables marked noise-sensitive moved within their own engine variance — treat those
        differences as rounding, not signal.
      </div>
    </div>
  );
}
