/**
 * The Future Dossier.
 *
 * A dossier is the plain-language brief for one path: where it leads, what it
 * costs, what it rests on, and how much the model is allowed to wobble. It
 * replaces the wall of numbers with a document somebody can actually read.
 *
 * Everything shown here comes from `core/dossier.ts`, which computes it from
 * the engine. This file only presents it.
 */
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { formatValue } from '../../core/vars';
import { NODE_TYPE_GUIDE } from '../../core/graphLegend';
import type { Dossier, DossierMetric } from '../../core/dossier';

export function DossierView({ store }: { store: Store }) {
  const state = useAppState(store);
  const nodeId = state.selected;

  // The store caches dossiers per node until the universe changes, so this is
  // a map lookup on every render rather than a recomputation.
  const dossier: Dossier | null = nodeId ? store.dossierFor(nodeId) : null;

  if (!nodeId || !dossier) {
    return (
      <main className="dossier-shell" aria-label="Path dossier">
        <div className="dossier-empty">
          <h2 className="dossier-empty-title">No path selected</h2>
          <p className="dossier-empty-body">
            Pick a card on the graph and this becomes the brief for that path — where it leads, what
            it costs, what it rests on, and how much the model is allowed to wobble.
          </p>
          <button className="btn btn-primary" onClick={() => store.setViewMode('graph')}>
            Back to the graph
          </button>
        </div>
      </main>
    );
  }

  const node = state.doc.nodes[nodeId];
  const guide = node ? NODE_TYPE_GUIDE[node.type] : null;
  const moved = dossier.metrics.filter((m) => m.tone !== 'flat');
  const shown = moved.length > 0 ? moved.slice(0, 10) : dossier.metrics.slice(0, 8);

  return (
    <main className="dossier-shell" aria-label="Path dossier">
      <div className="dossier">
        {/* ---------- header ---------- */}
        <header className="dossier-head">
          <div className="dossier-kicker">
            <span
              className="dossier-swatch"
              style={{ background: `hsl(${dossier.hue} 70% 60%)` }}
              aria-hidden="true"
            />
            Future dossier
            <span className="dossier-sep">·</span>
            {dossier.branchName}
          </div>
          <h2 className="dossier-title">{dossier.title}</h2>
          <div className="dossier-meta">
            <span className="chip">{dossier.atLabel}</span>
            <span className="chip">reaches {dossier.projectedLabel} out</span>
            {node && node.type !== 'start' && guide && <span className="chip">{guide.short}</span>}
            {node && node.horizon && node.horizon.toLowerCase() !== 'now' && (
              <span className="chip">{node.horizon}</span>
            )}
          </div>
          <p className="dossier-headline">{dossier.headline}</p>
          <p className="dossier-confidence">{dossier.confidence}</p>
        </header>

        {/* ---------- body ---------- */}
        <div className="dossier-grid">
          <section className="dossier-card">
            <h3 className="dossier-card-title">Where this leads</h3>
            <p className="dossier-card-sub">
              The model projects this path forward from here and compares it with where things stand
              at this point.
            </p>
            {shown.length === 0 ? (
              <p className="dossier-muted">The model does not track anything for this step.</p>
            ) : (
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>What</th>
                    <th className="num">Now</th>
                    <th className="num">Later</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <MetricRow key={m.key} metric={m} />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="dossier-card">
            <h3 className="dossier-card-title">How much it could wobble</h3>
            <p className="dossier-card-sub">{dossier.spreadNote}</p>
            {dossier.spread && dossier.headlineMetric ? (
              <div className="dossier-spread">
                <div className="dossier-spread-label">{dossier.headlineMetric.label}</div>
                <SpreadBar
                  low={dossier.spread.p10}
                  mid={dossier.spread.p50}
                  high={dossier.spread.p90}
                  unit={dossier.headlineMetric.unit}
                />
                <div className="dossier-spread-key">
                  <span>
                    <em>low</em> {formatValue(dossier.spread.p10, dossier.headlineMetric.unit)}
                  </span>
                  <span>
                    <em>typical</em> {formatValue(dossier.spread.p50, dossier.headlineMetric.unit)}
                  </span>
                  <span>
                    <em>high</em> {formatValue(dossier.spread.p90, dossier.headlineMetric.unit)}
                  </span>
                </div>
                <div className="dossier-spread-samples">
                  {dossier.spread.samples} runs of the same path with different internal choices.
                </div>
              </div>
            ) : (
              <p className="dossier-muted">
                There is no single number to spread out here, so this section stays empty rather
                than showing a made-up range.
              </p>
            )}
          </section>

          {dossier.gains.length > 0 && (
            <section className="dossier-card dossier-card-good">
              <h3 className="dossier-card-title">What it buys</h3>
              <ul className="dossier-list">
                {dossier.gains.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </section>
          )}

          {dossier.costs.length > 0 && (
            <section className="dossier-card dossier-card-bad">
              <h3 className="dossier-card-title">What it costs</h3>
              <ul className="dossier-list">
                {dossier.costs.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          {dossier.reasons.length > 0 && (
            <section className="dossier-card">
              <h3 className="dossier-card-title">How the model got here</h3>
              <ol className="dossier-steps">
                {dossier.reasons.map((r, i) => (
                  <li key={`${i}-${r.slice(0, 24)}`}>{r}</li>
                ))}
              </ol>
            </section>
          )}

          {dossier.risks.length > 0 && (
            <section className="dossier-card dossier-card-warn">
              <h3 className="dossier-card-title">What could go wrong</h3>
              <ul className="dossier-list">
                {dossier.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {dossier.nextSteps.length > 0 && (
            <section className="dossier-card">
              <h3 className="dossier-card-title">What happens next</h3>
              <ul className="dossier-list">
                {dossier.nextSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          )}

          {(dossier.stable.length > 0 ||
            dossier.moved.length > 0 ||
            dossier.sensitive.length > 0) && (
            <section className="dossier-card">
              <h3 className="dossier-card-title">What has moved so far</h3>
              <p className="dossier-card-sub">
                Compared with where you started. These are the numbers this path has already changed
                — and the ones it has left alone so far.
              </p>
              {dossier.moved.length > 0 && (
                <>
                  <div className="dossier-subhead">Moved</div>
                  <div className="dossier-chips">
                    {dossier.moved.map((s) => (
                      <span className="chip chip-cyan" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {dossier.sensitive.length > 0 && (
                <>
                  <div className="dossier-subhead">Moved, but the model treats it as jumpy</div>
                  <div className="dossier-chips">
                    {dossier.sensitive.map((s) => (
                      <span className="chip chip-amber" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {dossier.stable.length > 0 && (
                <>
                  <div className="dossier-subhead">Untouched so far</div>
                  <div className="dossier-chips">
                    {dossier.stable.map((s) => (
                      <span className="chip" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {(dossier.assumptions.length > 0 || dossier.influentialInputs.length > 0) && (
            <section className="dossier-card">
              <h3 className="dossier-card-title">What it rests on</h3>
              {dossier.assumptions.length > 0 && (
                <ul className="dossier-list">
                  {dossier.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {dossier.influentialInputs.length > 0 && (
                <>
                  <div className="dossier-subhead">
                    Inputs with the most influence on the outcome
                  </div>
                  <div className="dossier-chips">
                    {dossier.influentialInputs.map((i) => (
                      <span className="chip chip-violet" key={i.label}>
                        {i.label} · {i.influence}%
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </div>

        {/* ---------- footer ---------- */}
        <footer className="dossier-foot">
          <p>
            This is a model built from the numbers you gave it. It shows consequences, not
            prophecies. Nothing here is a prediction about what will happen to you.
          </p>
          {dossier.provenance && <p className="dossier-provenance">{dossier.provenance}</p>}
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => store.setViewMode('graph')}>
              ← Back to the graph
            </button>
            <button className="btn btn-ghost" onClick={() => store.setViewMode('timeline')}>
              See the timeline
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                const { exportPathAsPdf, pdfExportMessage } = await import('../utils/exportPdf');
                const result = await exportPathAsPdf(state.doc, nodeId);
                const message = pdfExportMessage(result);
                store.toast(message.text, message.tone);
              }}
              title="Save this brief as a printable PDF"
            >
              🖨 Export PDF
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}

function MetricRow({ metric }: { metric: DossierMetric }) {
  const tone = metric.tone === 'better' ? 'good' : metric.tone === 'worse' ? 'bad' : 'flat';
  return (
    <tr>
      <td title={metric.hint}>
        {metric.label}
        {metric.noisy && (
          <span className="dossier-noisy" title="The model treats this as jumpy">
            ≈
          </span>
        )}
      </td>
      <td className="num">{metric.nowText}</td>
      <td className="num">{metric.projectedText}</td>
      <td className={`num dossier-tone-${tone}`}>{metric.deltaText}</td>
    </tr>
  );
}

function SpreadBar({
  low,
  mid,
  high,
  unit,
}: {
  low: number;
  mid: number;
  high: number;
  unit: DossierMetric['unit'];
}) {
  const min = Math.min(low, mid, high);
  const max = Math.max(low, mid, high);
  const span = max - min || 1;
  const leftPct = ((low - min) / span) * 100;
  const widthPct = ((high - low) / span) * 100;
  const midPct = ((mid - min) / span) * 100;
  return (
    <div className="dossier-bar">
      <div className="dossier-bar-track">
        <div
          className="dossier-bar-range"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1.5)}%` }}
        />
        <div className="dossier-bar-mid" style={{ left: `${midPct}%` }} />
      </div>
      <div className="dossier-bar-numbers">
        <span>{formatValue(low, unit)}</span>
        <span>{formatValue(high, unit)}</span>
      </div>
    </div>
  );
}
