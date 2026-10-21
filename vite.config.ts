import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Single source of truth for the app version: package.json. Vite injects it as a
// compile-time constant so the export envelope, generated reports and the
// renderer can never drift from the version that electron-builder ships.
const APP_VERSION = pkg.version;

// `base: './'` is required: Electron loads the production renderer over file://
// and absolute asset paths would otherwise resolve to the filesystem root.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5199,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
