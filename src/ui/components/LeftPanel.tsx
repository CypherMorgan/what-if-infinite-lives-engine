/**
 * Left panel: scenario summary, search, branch toggles and the node list.
 */
import { useMemo } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { searchNodes, visibleNodes } from '../../core/graph';
import {
  NODE_TYPE_GUIDE,
  describeHorizon,
  describeImagination,
  imaginationLabel,
} from '../../core/graphLegend';

const HUE_DOT = (hue: number): string => `hsl(${((hue % 360) + 360) % 360} 70% 62%)`;

export function LeftPanel({ store }: { store: Store }) {
  const state = useAppState(store);

  const branches = useMemo(() => Object.values(state.doc.branches), [state.doc.branches]);
  const visible = useMemo(() => visibleNodes(state.doc), [state.doc]);

  const hits = useMemo(() => {
    const q = state.query.trim();
    if (q.length < 2) return null;
    return searchNodes(state.doc, q, 80);
  }, [state.doc, state.query]);

  const listed = useMemo(() => {
    if (hits) {
      const order = new Map(hits.map((h, i) => [h.id, i]));
      return visible
        .filter((n) => order.has(n.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    return [...visible].sort((a, b) => a.depth - b.depth || a.t - b.t);
  }, [visible, hits]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of Object.values(state.doc.nodes)) map.set(n.branch, (map.get(n.branch) ?? 0) + 1);
    return map;
  }, [state.doc.nodes]);

  const prompt = state.doc.prompt;

  return (
    <aside className="panel panel-left">
      <div className="panel-head">
        <span className="panel-title">Universe</span>
        <span className="spacer" />
        <span className="chip">{Object.keys(state.doc.nodes).length} steps</span>
      </div>

      <div className="panel-body">
        <div className="section">
          <div className="note" style={{ marginBottom: 10 }}>
            <strong>{state.doc.prompt.decision || state.doc.title}</strong>
            <div
              style={{ marginTop: 4, color: 'var(--text-faint)', fontSize: 11 }}
              title={describeImagination(prompt.imagination)}
            >
              Looking ahead {describeHorizon(prompt.horizon)} · {prompt.branchCount} possible path
              {prompt.branchCount === 1 ? '' : 's'} · {imaginationLabel(prompt.imagination)} reach
            </div>
          </div>

          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              className="input"
              placeholder="Search steps, evidence, uncertainties…"
              value={state.query}
              onChange={(e) => store.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') store.setQuery('');
              }}
              aria-label="Search the universe"
            />
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">Paths</h2>
          <div className="node-list">
            {branches.map((b) => {
              const collapsed = state.doc.collapsed.includes(b.id);
              const rootSelected =
                state.selected && state.doc.nodes[state.selected]?.branch === b.id;
              return (
                <button
                  key={b.id}
                  className={`node-item ${rootSelected ? 'selected' : ''}`}
                  onClick={() => {
                    const root = state.doc.nodes[b.root];
                    if (root) {
                      store.select(b.root);
                      store.centerOn?.(b.root);
                    }
                  }}
                  title={`${b.description}\n(click to focus · use the chevron to collapse)`}
                >
                  <span className="dot" style={{ background: HUE_DOT(b.hue) }} />
                  <span className="label">{b.name}</span>
                  <span className="kind">{counts.get(b.id) ?? 0}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={collapsed ? 'Show branch' : 'Collapse branch'}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.toggleBranchCollapse(b.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        store.toggleBranchCollapse(b.id);
                      }
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 4,
                      fontSize: 10,
                      color: 'var(--text-faint)',
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    {collapsed ? '+' : '−'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">{hits ? `Matches (${listed.length})` : 'Steps'}</h2>
          {listed.length === 0 ? (
            <div className="empty">
              <div className="empty-title">Nothing matches “{state.query}”</div>
              Try a shorter search — at least two characters.
            </div>
          ) : (
            <div className="node-list">
              {listed.map((n) => (
                <button
                  key={n.id}
                  className={`node-item ${state.selected === n.id ? 'selected' : ''}`}
                  onClick={() => {
                    store.select(n.id);
                    store.centerOn?.(n.id);
                  }}
                >
                  <span
                    className="dot"
                    style={{ background: HUE_DOT(state.doc.branches[n.branch]?.hue ?? 200) }}
                  />
                  <span className="label">{n.title}</span>
                  <span className="kind">{NODE_TYPE_GUIDE[n.type].short}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
