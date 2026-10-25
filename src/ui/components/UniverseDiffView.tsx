/**
 * Comparing two universes.
 *
 * The path diff answers "these two paths, specifically". This view answers the
 * question behind a fork: "I changed something — what did it do?" It shows the
 * assumptions that differ, the paths the two universes share, and the outcomes
 * that moved, plus the paths that only one of them has.
 *
 * The wording is deliberately careful. A difference is only attributed to a
 * changed assumption when the two universes share a question and a random
 * draw; otherwise the view says which other things differ.
 */
import { useState } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import type {
  UniverseDiff,
  UniversePathComparison,
  AssumptionDifference,
} from '../../core/universeDiff';
import { largestGaps } from '../../core/compareMetrics';
import { MetricTable } from './MetricTable';

export function UniverseDiffView({ store }: { store: Store }) {
  const state = useAppState(store);
  const pair = state.universePair;

  if (!pair) {
    return (
      <main className="dossier-shell" aria-label="Comparing two universes">
        <div className="dossier-empty">
          <h2 className="dossier-empty-title">No universes chosen</h2>
          <p className="dossier-empty-body">
            A fork is a copy of a universe with one thing changed. Pick two and this will put them
            side by side: what is different in the setup, which paths they share, and what ends up
            different.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => store.openModal({ kind: 'universes' })}
          >
            Choose two universes
          </button>
        </div>
      </main>
    );
  }

  const diff = store.universeDiffFor(pair);

  if (!diff) {
    return (
      <main className="dossier-shell" aria-label="Comparing two universes">
        <div className="dossier-empty">
          <h2 className="dossier-empty-title">Those universes cannot be compared</h2>
          <p className="dossier-empty-body">
            One of them is no longer saved. Choose another pair from your library.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => store.openModal({ kind: 'universes' })}
          >
            Choose two universes
          </button>
        </div>
      </main>
    );
  }

  return (
    <DiffBody
      key={`${diff.a.id}|${diff.b.id}`}
      store={store}
      diff={diff}
      currentDocId={state.doc.id}
    />
  );
}

function DiffBody({
  store,
  diff,
  currentDocId,
}: {
  store: Store;
  diff: UniverseDiff;
  currentDocId: string;
}) {
  const [activePath, setActivePath] = useState(diff.paths[0]?.name ?? '');
  const active = diff.paths.find((p) => p.name === activePath) ?? diff.paths[0] ?? null;

  return (
    <main className="dossier-shell" aria-label="Comparing two universes">
      <div className="dossier">
        <header className="dossier-head">
          <div className="dossier-kicker">Comparing two universes</div>
          <h2 className="dossier-title">
            <UniverseName title={diff.a.title} /> <span className="dossier-vs">versus</span>{' '}
            <UniverseName title={diff.b.title} />
          </h2>
          <p className="dossier-headline">{diff.headline}</p>
          <p className="dossier-confidence">{diff.verdict}</p>

          <div className="dossier-divergence">
            <strong>How they are related.</strong> {diff.relationship.label}
            {diff.lineageNotes.length > 0 && (
              <ul className="dossier-list" style={{ marginTop: 7 }}>
                {diff.lineageNotes.map((note, i) => (
                  <li key={`${i}-${note.slice(0, 24)}`}>{note}</li>
                ))}
              </ul>
            )}
          </div>

          {(!diff.sameQuestion || !diff.sameSeed) && (
            <div className="note note-amber" style={{ marginTop: 14 }}>
              {!diff.sameQuestion
                ? 'These universes do not answer the same question. Read this as two separate answers, not two versions of one.'
                : 'These universes answer the same question but were re-run with different random draws. Part of any difference comes from the draw, not from the assumptions.'}
            </div>
          )}
        </header>

        {/* ---------- the setup ---------- */}
        <section className="dossier-card" style={{ marginBottom: 14 }}>
          <h3 className="dossier-card-title">What is different in the setup</h3>
          <p className="dossier-card-sub">
            The assumptions each universe was built with. Only the ones that differ are listed;
            everything else starts the same.
          </p>
          {diff.changedAssumptions.length === 0 ? (
            <p className="dossier-muted">
              The two universes start from the same assumptions. Any difference below comes from the
              paths themselves, not from an assumption you changed.
            </p>
          ) : (
            <>
              <table className="dossier-table">
                <caption className="sr-only">
                  Assumptions that differ between {diff.a.title} and {diff.b.title}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col" className="num">
                      {diff.a.title}
                    </th>
                    <th scope="col" className="num">
                      {diff.b.title}
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changedAssumptions.map((change) => (
                    <AssumptionRow key={change.key} change={change} />
                  ))}
                </tbody>
              </table>
              {diff.sharedAssumptionCount > 0 && (
                <p className="dossier-muted" style={{ marginTop: 10 }}>
                  {diff.sharedAssumptionCount} other assumption
                  {diff.sharedAssumptionCount === 1 ? '' : 's'} the two universes share are the
                  same.
                </p>
              )}
            </>
          )}
        </section>

        {/* ---------- the outcomes ---------- */}
        <section className="dossier-card">
          <h3 className="dossier-card-title">What ends up different</h3>
          <p className="dossier-card-sub">
            Both universes are projected forward to {diff.compareLabel} before their paths are
            compared, so a difference in timing is never reported as a difference in the path. Only
            paths that exist in both universes are paired.
          </p>

          {diff.paths.length === 0 ? (
            <p className="dossier-muted">
              The two universes do not share a named path, so the model cannot line them up like for
              like. The paths each one has are listed below.
            </p>
          ) : (
            <>
              <table className="dossier-table">
                <caption className="sr-only">
                  How the shared paths differ at {diff.compareLabel}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Largest differences</th>
                    <th scope="col">Favours</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.paths.map((path) => (
                    <tr key={path.name}>
                      <td>{path.name}</td>
                      <td className="dossier-tone-flat">
                        {path.diffCount === 0
                          ? 'nothing the model tracks'
                          : largestGaps(path.metrics)}
                      </td>
                      <td>{favoursLabel(path, diff.a.title, diff.b.title)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {diff.paths.length > 1 && (
                <div
                  className="uni-path-tabs"
                  role="group"
                  aria-label="Choose a shared path to inspect"
                >
                  {diff.paths.map((path) => (
                    <button
                      key={path.name}
                      type="button"
                      className={`btn btn-sm ${active?.name === path.name ? 'btn-primary' : 'btn-ghost'}`}
                      aria-pressed={active?.name === path.name}
                      onClick={() => setActivePath(path.name)}
                    >
                      {path.name}
                      <span className="uni-path-count">{path.diffCount}</span>
                    </button>
                  ))}
                </div>
              )}

              {active && (
                <>
                  <div className="dossier-subhead" style={{ marginTop: 16 }}>
                    Detail for “{active.name}”
                  </div>
                  <p className="dossier-muted" style={{ marginBottom: 10 }}>
                    On the first universe this path ends at “{active.aEndTitle}” (
                    {active.aEndAtLabel}); on the second, at “{active.bEndTitle}” (
                    {active.bEndAtLabel}).
                  </p>
                  <MetricTable
                    metrics={active.metrics}
                    aName={diff.a.title}
                    bName={diff.b.title}
                    caption={`What differs on ${active.name} between ${diff.a.title} and ${diff.b.title} at ${diff.compareLabel}`}
                    empty={`The model finds no difference on this path at ${diff.compareLabel}. It may still be a different journey.`}
                  />
                  <p className="dossier-muted" style={{ marginTop: 8 }}>
                    {active.verdict}
                  </p>
                </>
              )}
            </>
          )}
        </section>

        {/* ---------- paths one side only ---------- */}
        {(diff.onlyA.length > 0 || diff.onlyB.length > 0) && (
          <section className="dossier-card" style={{ marginTop: 14 }}>
            <h3 className="dossier-card-title">Paths only one universe has</h3>
            <p className="dossier-card-sub">
              These paths have no counterpart in the other universe. They are shown as they are
              rather than paired with something that only looks similar.
            </p>
            <div className="dossier-grid">
              <OnlyPathList
                title={`Only in “${diff.a.title}”`}
                paths={diff.onlyA}
                empty="No path is unique to this universe."
              />
              <OnlyPathList
                title={`Only in “${diff.b.title}”`}
                paths={diff.onlyB}
                empty="No path is unique to this universe."
              />
            </div>
          </section>
        )}

        <footer className="dossier-foot">
          <p>
            "Favours" means the direction the model considers better for that variable — more money,
            less stress, more runway. It is not a recommendation, and a changed assumption is not a
            claim about what would have happened in real life.
          </p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => store.setViewMode('graph')}>
              ← Back to the graph
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => store.openModal({ kind: 'universes' })}
            >
              Compare other universes
            </button>
            {diff.b.id !== currentDocId && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  store.openFromLibrary(diff.b.id);
                  store.setViewMode('graph');
                }}
              >
                Open “{diff.b.title}”
              </button>
            )}
          </div>
        </footer>
      </div>
    </main>
  );
}

function UniverseName({ title }: { title: string }) {
  return <span className="universe-name">{title}</span>;
}

function AssumptionRow({ change }: { change: AssumptionDifference }) {
  return (
    <tr>
      <td>{change.label}</td>
      <td className="num">{change.aText}</td>
      <td className="num">{change.bText}</td>
      <td className={change.kind === 'changed' ? 'num' : 'dossier-tone-flat'}>
        {change.kind === 'changed'
          ? change.deltaText
          : change.kind === 'only-a'
            ? 'only in the first'
            : 'only in the second'}
      </td>
    </tr>
  );
}

function OnlyPathList({
  title,
  paths,
  empty,
}: {
  title: string;
  paths: UniverseDiff['onlyA'];
  empty: string;
}) {
  return (
    <div>
      <div className="dossier-subhead">{title}</div>
      {paths.length === 0 ? (
        <p className="dossier-muted">{empty}</p>
      ) : (
        <ul className="dossier-list">
          {paths.map((path) => (
            <li key={path.name}>
              <strong>{path.name}</strong> — ends at “{path.endTitle}” ({path.endAtLabel})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function favoursLabel(path: UniversePathComparison, aTitle: string, bTitle: string): string {
  if (path.diffCount === 0) return '—';
  if (path.aAhead === path.bAhead) {
    return path.aAhead === 0 ? 'neither' : 'split evenly';
  }
  return path.aAhead > path.bAhead ? aTitle : bTitle;
}
