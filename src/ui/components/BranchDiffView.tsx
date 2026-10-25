/**
 * Comparing two paths, side by side.
 *
 * The graph shows every path at once. This view answers the other question:
 * these two, specifically — where do they part company, and what is different
 * at the end?
 *
 * The two columns are the two paths as the model actually built them. The
 * table underneath is the same comparison in numbers, made at a common moment
 * so that a difference in *time* is never mistaken for a difference in *path*.
 */
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import type { BranchDiff, BranchDiffSide } from '../../core/branchDiff';
import { MetricTable } from './MetricTable';

export function BranchDiffView({ store }: { store: Store }) {
  const state = useAppState(store);
  const pair = state.diffBranches;

  if (!pair) {
    return (
      <main className="dossier-shell" aria-label="Comparing two paths">
        <div className="dossier-empty">
          <h2 className="dossier-empty-title">No paths chosen</h2>
          <p className="dossier-empty-body">
            Pick two paths and this will put them side by side: the steps each one takes, where they
            part company, and what ends up different.
          </p>
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'compare' })}>
            Choose two paths
          </button>
        </div>
      </main>
    );
  }

  const diff = store.diffFor(pair.a, pair.b);

  if (!diff) {
    return (
      <main className="dossier-shell" aria-label="Comparing two paths">
        <div className="dossier-empty">
          <h2 className="dossier-empty-title">Those paths cannot be compared</h2>
          <p className="dossier-empty-body">
            One of the paths no longer exists in this universe. Choose another pair.
          </p>
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'compare' })}>
            Choose two paths
          </button>
        </div>
      </main>
    );
  }

  return <DiffBody store={store} diff={diff} />;
}

function DiffBody({ store, diff }: { store: Store; diff: BranchDiff }) {
  const rows = Math.max(diff.a.steps.length, diff.b.steps.length);

  return (
    <main className="dossier-shell" aria-label="Comparing two paths">
      <div className="dossier">
        <header className="dossier-head">
          <div className="dossier-kicker">Comparing two paths</div>
          <h2 className="dossier-title">
            <SideName side={diff.a} /> <span className="dossier-vs">versus</span>{' '}
            <SideName side={diff.b} />
          </h2>
          <p className="dossier-headline">{diff.headline}</p>
          <p className="dossier-confidence">{diff.verdict}</p>
          {diff.divergedAt && (
            <div className="dossier-divergence">
              {diff.divergedAt.isStart ? (
                <>
                  They part company at the very first choice —{' '}
                  <strong>{diff.divergedAt.title}</strong>, {diff.divergedAt.atLabel}.
                </>
              ) : (
                <>
                  They share everything up to <strong>{diff.divergedAt.title}</strong> (
                  {diff.divergedAt.atLabel}), and split after that.
                </>
              )}
            </div>
          )}
        </header>

        {/* ---------- the two paths, side by side ---------- */}
        <section className="dossier-card dossier-paths">
          <h3 className="dossier-card-title">The two paths</h3>
          <p className="dossier-card-sub">
            The steps the model built for each path, in the order they happen. Rows line up by
            position, not by date — the paths rarely take the same number of steps.
          </p>
          <div className="diff-columns">
            <PathColumn side={diff.a} rows={rows} onSelect={(id) => store.select(id)} />
            <PathColumn side={diff.b} rows={rows} onSelect={(id) => store.select(id)} />
          </div>
        </section>

        {/* ---------- the numbers ---------- */}
        <section className="dossier-card">
          <h3 className="dossier-card-title">What ends up different</h3>
          <p className="dossier-card-sub">
            Both paths are projected forward to {diff.compareLabel} before they are compared, so
            every difference below is a difference in the path rather than in the timing.
          </p>
          {diff.metrics.length === 0 ? (
            <p className="dossier-muted">
              The model finds no difference between these two paths at {diff.compareLabel}. They may
              still be different journeys — it just cannot tell them apart in the numbers it tracks.
            </p>
          ) : (
            <MetricTable
              metrics={diff.metrics}
              aName={diff.a.name}
              bName={diff.b.name}
              caption={`What differs between ${diff.a.name} and ${diff.b.name} at ${diff.compareLabel}`}
              empty=""
            />
          )}
          {diff.sameCount > 0 && (
            <p className="dossier-muted" style={{ marginTop: 10 }}>
              {diff.sameCount} other thing{diff.sameCount === 1 ? '' : 's'} the model tracks end up
              the same on both paths.
            </p>
          )}
        </section>

        <footer className="dossier-foot">
          <p>
            "Favours" means the direction the model considers better for that variable — more money,
            less stress, more runway. It is not a recommendation: the model does not know which of
            the two lives you would rather have.
          </p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => store.setViewMode('graph')}>
              ← Back to the graph
            </button>
            <button className="btn btn-ghost" onClick={() => store.openModal({ kind: 'compare' })}>
              Compare other paths
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}

function SideName({ side }: { side: BranchDiffSide }) {
  return (
    <span className="diff-side-name">
      <span
        className="dossier-swatch"
        style={{ background: `hsl(${side.hue} 70% 60%)` }}
        aria-hidden="true"
      />
      {side.name}
    </span>
  );
}

function PathColumn({
  side,
  rows,
  onSelect,
}: {
  side: BranchDiffSide;
  rows: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="diff-column" aria-label={`The steps on ${side.name}`}>
      <div className="diff-column-head" style={{ borderColor: `hsl(${side.hue} 60% 45%)` }}>
        <span className="diff-column-name">{side.name}</span>
        {side.description && <span className="diff-column-desc">{side.description}</span>}
      </div>
      {Array.from({ length: rows }, (_, i) => {
        const step = side.steps[i];
        if (!step) return <div key={`empty-${i}`} className="diff-step diff-step-empty" />;
        return (
          <button
            key={step.id}
            type="button"
            className="diff-step"
            onClick={() => onSelect(step.id)}
            title={step.summary}
          >
            <span className="diff-step-time">{step.atLabel}</span>
            <span className="diff-step-title">{step.title}</span>
            <span className="diff-step-type">{step.typeName}</span>
          </button>
        );
      })}
    </div>
  );
}
