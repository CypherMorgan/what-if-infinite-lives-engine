import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` is required: Electron loads the production renderer over file://
// and absolute asset paths would otherwise resolve to the filesystem root.
export default defineConfig({
  base: './',
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
