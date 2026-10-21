/**
 * The introduction.
 *
 * Shown the first time somebody opens the app, and available again afterwards.
 *
 * The tour that used to run on first launch pointed at panels and said what
 * they were called. It never said what the thing *was*. A newcomer who
 * understands the idea can work out where the buttons are; a newcomer who
 * does not will not know what to ask the app. So this card explains the idea
 * first, in ordinary words, and offers the tour afterwards for anyone who
 * wants it.
 */
import { useEffect, useState } from 'react';
import { GRAPH_ORIENTATION } from '../../core/graphLegend';
import { startTour } from '../tour';

const ORIENTATION_KEY = 'whatifs:orientation:v1';

function seen(): boolean {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(ORIENTATION_KEY, '1');
  } catch {
    // ignore
  }
}

export function OrientationCard() {
  const [visible, setVisible] = useState<boolean>(() => !seen());

  useEffect(() => {
    const onShow = (): void => setVisible(true);
    window.addEventListener('whatifs:show-orientation', onShow);
    return () => window.removeEventListener('whatifs:show-orientation', onShow);
  }, []);

  if (!visible) return null;

  const dismiss = (): void => {
    remember();
    setVisible(false);
  };

  return (
    <aside className="orientation" aria-label="How this app works">
      <div className="orientation-head">
        <h2 className="orientation-title">So — what is this?</h2>
        <button className="btn btn-sm btn-ghost" onClick={dismiss} aria-label="Close">
          ✕
        </button>
      </div>

      <p className="orientation-lede">
        This tool maps out what could happen if you took a different path — and what each path would
        cost you. It is a model built from the numbers you give it, not a prophecy.
      </p>

      <ul className="orientation-points">
        {GRAPH_ORIENTATION.points.map((p) => (
          <li key={p.heading}>
            <strong>{p.heading}</strong>
            <span>{p.body}</span>
          </li>
        ))}
      </ul>

      <div className="orientation-actions">
        <button
          className="btn btn-primary"
          onClick={() => {
            remember();
            setVisible(false);
            startTour();
          }}
        >
          Show me around
        </button>
        <button className="btn btn-ghost" onClick={dismiss}>
          Start exploring
        </button>
      </div>
    </aside>
  );
}
