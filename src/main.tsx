/**
 * Renderer entry point.
 *
 * Boots the store from (in order): last-saved universe in local storage, a
 * freshly generated offline universe, so the app is never an empty shell.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './ui/App';
import { Store } from './ui/state/store';
import { demoUniverse } from './core/demo';
import { importFromText } from './core/importExport';
import type { SimulationDoc } from './core/types';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { bootstrapInstalledPacks } from './ui/state/rulePacks';

const STORAGE_PREFIX = 'whatifs:doc:';

// Installed packs are part of the catalogue, so they have to be active before
// the first universe is generated rather than after the store exists.
bootstrapInstalledPacks();

function bootDocument(): SimulationDoc {
  // 1. last opened universe
  try {
    const lastId = localStorage.getItem('whatifs:last');
    if (lastId) {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${lastId}`);
      if (raw) {
        const result = importFromText(raw);
        if (result.ok) return result.value.doc;
        // deliberately fall through: a corrupt save must not block startup
        console.warn('[whatifs] stored universe failed to load:', result.error.message);
      }
    }
  } catch (err) {
    console.warn('[whatifs] local storage unavailable:', err);
  }

  // 2. a first-run universe so the window is never empty
  return demoUniverse();
}

const store = new Store(bootDocument());

// Temporary: expose for manual debugging in the devtools console.
if (import.meta.env.DEV) {
  (window as unknown as { __whatifs?: unknown }).__whatifs = store;
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing.');
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App store={store} />
    </ErrorBoundary>
  </StrictMode>
);

// persist the camera when the window closes
window.addEventListener('beforeunload', () => store.saveCamera());

// The introduction card (see `ui/components/OrientationCard.tsx`) is the
// first-run experience. It used to be a pop-up tour that pointed at panels and
// named them; it never explained what the app was for. The card explains the
// idea first and offers the tour to anyone who wants it, so the two no
// longer fight over the first launch.
