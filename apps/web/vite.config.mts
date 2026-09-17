/// <reference types='vitest' />
import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { iconSetsPlugin } from '../../tools/icon-sets.mjs';

// Where the API runs in development. Both REST and Socket.io are proxied through the Vite dev
// server, so the browser only ever talks to its own origin and the API needs no CORS setup.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig(() => ({
  root: import.meta.dirname,
  // The path the app is served under: "/" by default, the repository path on a GitHub Pages
  // project site (set by the deploy workflow).
  base: process.env.VITE_BASE_PATH ?? '/',
  cacheDir: '../../node_modules/.vite/apps/web',
  resolve: {
    // '@ft/source' makes workspace libraries (@ft/shared-contracts) resolve to their TypeScript
    // source instead of a built dist, so a contract change is picked up without rebuilding the
    // lib first — a stale dist is exactly the trap this repo has hit before.
    conditions: ['@ft/source', ...defaultClientConditions],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 4200,
    host: 'localhost',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  preview: {
    port: 4200,
    host: 'localhost',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  // The extra icon sets are generated into public/icons from their packages, never committed.
  plugins: [react(), tailwindcss(), iconSetsPlugin(fileURLToPath(new URL('./public/icons', import.meta.url)))],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
