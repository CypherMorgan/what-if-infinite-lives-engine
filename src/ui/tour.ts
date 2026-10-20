/**
 * Onboarding tour using driver.js.
 * Runs once on first launch to highlight key UI elements.
 */
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_KEY = 'whatifs:tour:v1';

export function maybeStartTour(): void {
  try {
    if (localStorage.getItem(TOUR_KEY)) return;
  } catch {
    return;
  }

  // Delay slightly so layout is rendered
  window.setTimeout(() => {
    const drv = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      steps: [
        {
          element: '.brand',
          popover: {
            title: 'What If? — The Infinite Lives Engine',
            description:
              'Explore plausible alternative life paths through branching timelines and deterministic simulations. Everything runs locally by default.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '.panel-left',
          popover: {
            title: 'Universe Explorer',
            description:
              'Browse branches, search nodes, and see the structure of your multiverse. Click a node to focus it.',
            side: 'right',
            align: 'start',
          },
        },
        {
          element: '.canvas-host',
          popover: {
            title: 'Interactive Graph',
            description:
              'Pan, zoom, drag nodes, and navigate paths. Double-click a node to expand it. Use the minimap for orientation.',
            side: 'left',
            align: 'center',
          },
        },
        {
          element: '.panel-right',
          popover: {
            title: 'Inspector',
            description:
              'View state, evidence, tradeoffs, and assumptions. Expand nodes, create counterfactuals, or compare branches here.',
            side: 'left',
            align: 'start',
          },
        },
        {
          element: '.topbar',
          popover: {
            title: 'Controls',
            description:
              'Create new universes, undo/redo, expand, reroll, import/export, and access settings. All changes are tracked locally.',
            side: 'bottom',
            align: 'center',
          },
        },
      ],
      onDestroyed: () => {
        try {
          localStorage.setItem(TOUR_KEY, '1');
        } catch {
          // ignore
        }
      },
    });
    drv.drive();
  }, 800);
}
