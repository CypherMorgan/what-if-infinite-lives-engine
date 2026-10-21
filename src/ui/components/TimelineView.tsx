/**
 * Timeline view - chronological layout of nodes by time.
 */
import { useMemo } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { NODE_TYPE_GUIDE } from '../../core/graphLegend';

const HUE_DOT = (hue: number): string => `hsl(${((hue % 360) + 360) % 360} 70% 62%)`;

export function TimelineView({ store }: { store: Store }) {
  const state = useAppState(store);

  const nodes = useMemo(() => {
    return Object.values(state.doc.nodes)
      .filter((n) => n.type !== 'start' || true)
      .sort((a, b) => a.t - b.t || a.depth - b.depth);
  }, [state.doc.nodes]);

  const branches = state.doc.branches;

  return (
    <main
      aria-label="The timeline"
      style={{
        gridArea: 'stage',
        background: 'var(--bg-void)',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '24px 32px',
        position: 'relative',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 6px',
            }}
          >
            Timeline
          </h2>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>
            Every step in order of when it happens — {nodes.length} step
            {nodes.length === 1 ? '' : 's'} in total.
          </p>
        </div>

        <div style={{ position: 'relative', paddingLeft: 32 }}>
          {/* Vertical line */}
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 0,
              bottom: 0,
              width: 2,
              background: 'linear-gradient(to bottom, var(--cyan-dim), var(--line))',
            }}
          />

          {nodes.map((node) => {
            const branch = branches[node.branch];
            const isSelected = state.selected === node.id;
            const hue = branch?.hue ?? 200;

            return (
              <div
                key={node.id}
                style={{
                  position: 'relative',
                  marginBottom: 18,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  store.select(node.id);
                  store.centerOn(node.id);
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    position: 'absolute',
                    left: -26,
                    top: 14,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: HUE_DOT(hue),
                    boxShadow: isSelected ? `0 0 0 4px rgba(79, 216, 255, 0.2)` : 'none',
                    border: isSelected ? '2px solid var(--cyan)' : '2px solid var(--bg-void)',
                  }}
                />

                {/* Card */}
                <div
                  className={`variant-card ${isSelected ? 'chosen' : ''}`}
                  style={{
                    marginBottom: 0,
                    padding: '12px 16px',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: HUE_DOT(hue),
                        fontWeight: 600,
                      }}
                    >
                      {node.t === 0 ? 'now' : `month ${node.t}`}
                    </span>
                    {node.horizon && node.horizon.toLowerCase() !== 'now' && (
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        {node.horizon}
                      </span>
                    )}
                    <span className="chip" style={{ marginLeft: 'auto' }}>
                      {NODE_TYPE_GUIDE[node.type].short}
                    </span>
                    <span
                      className="chip"
                      style={{ borderColor: HUE_DOT(hue), color: HUE_DOT(hue) }}
                    >
                      {branch?.name ?? node.branch}
                    </span>
                  </div>

                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 15,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    {node.title}
                  </div>

                  <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {node.summary}
                  </div>

                  {node.tradeoffs && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 16,
                        marginTop: 10,
                        fontSize: 11.5,
                      }}
                    >
                      {node.tradeoffs.gains.length > 0 && (
                        <div style={{ color: 'var(--green)' }}>
                          +{node.tradeoffs.gains.length} gain
                          {node.tradeoffs.gains.length === 1 ? '' : 's'}
                        </div>
                      )}
                      {node.tradeoffs.costs.length > 0 && (
                        <div style={{ color: 'var(--amber)' }}>
                          −{node.tradeoffs.costs.length} cost
                          {node.tradeoffs.costs.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
