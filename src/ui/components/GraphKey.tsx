/**
 * The key to the graph.
 *
 * A newcomer looking at the canvas has no way to decode it: the symbols are
 * unexplained, the colours are arbitrary, and nothing says which direction
 * time runs. This panel answers all three, in words, next to the thing it
 * describes.
 *
 * It is open by default and can be closed. The choice is remembered, because
 * somebody who has understood the graph once should not be told again.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { NODE_TYPE_GUIDE, NODE_TYPE_ORDER } from '../../core/graphLegend';

const KEY_OPEN_KEY = 'whatifs:key-open';

const HUE_DOT = (hue: number): string => `hsl(${((hue % 360) + 360) % 360} 70% 62%)`;

function readInitialOpen(): boolean {
  try {
    const stored = localStorage.getItem(KEY_OPEN_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // ignore — fall through to the default
  }
  return true;
}

export function GraphKey({ store }: { store: Store }) {
  const state = useAppState(store);
  const [open, setOpen] = useState<boolean>(readInitialOpen);

  const branches = useMemo(() => Object.values(state.doc.branches), [state.doc.branches]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_OPEN_KEY, open ? '1' : '0');
    } catch {
      // ignore
    }
  }, [open]);

  if (!open) {
    return (
      <div className="stage-bottom-left">
        <button
          className="btn btn-ghost graph-key-toggle"
          onClick={() => setOpen(true)}
          aria-label="Show the key to the graph"
        >
          ? Key
        </button>
      </div>
    );
  }

  return (
    <div className="stage-bottom-left">
      <div className="graph-key" role="note" aria-label="How to read this graph">
        <div className="graph-key-head">
          <span className="graph-key-title">How to read this</span>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setOpen(false)}
            aria-label="Hide the key"
          >
            ✕
          </button>
        </div>

        <div className="graph-key-row">
          <span className="graph-key-label">Time</span>
          <span className="graph-key-text">
            <span className="graph-key-strong">now → later</span>. Cards further right are further
            in the future.
          </span>
        </div>

        <div className="graph-key-row">
          <span className="graph-key-label">Symbols</span>
          <span className="graph-key-text">What kind of thing each card is.</span>
        </div>
        <div className="graph-key-types">
          {NODE_TYPE_ORDER.map((type) => {
            const guide = NODE_TYPE_GUIDE[type];
            return (
              <div className="graph-key-type" key={type} title={guide.meaning}>
                <span
                  className="graph-key-glyph"
                  style={{ color: `rgb(${guide.tint[0]}, ${guide.tint[1]}, ${guide.tint[2]})` }}
                >
                  {guide.glyph}
                </span>
                <span className="graph-key-type-name">{guide.short}</span>
              </div>
            );
          })}
        </div>

        {branches.length > 0 && (
          <div className="graph-key-row graph-key-row-block">
            <span className="graph-key-label">Branches</span>
            <span className="graph-key-text">One colour per possible direction.</span>
          </div>
        )}
        <div className="graph-key-branches">
          {branches.map((b) => (
            <span className="graph-key-branch" key={b.id}>
              <span className="dot" style={{ background: HUE_DOT(b.hue) }} />
              {b.name}
            </span>
          ))}
        </div>

        <div className="graph-key-row graph-key-row-block">
          <span className="graph-key-label">On a card</span>
          <span className="graph-key-text">
            The word at the top says what it is. The title says what happens. The number at the
            bottom is how many months from now it sits.
          </span>
        </div>

        <button
          className="graph-key-more"
          onClick={() => window.dispatchEvent(new Event('whatifs:show-orientation'))}
        >
          Read the introduction again
        </button>
      </div>
    </div>
  );
}
