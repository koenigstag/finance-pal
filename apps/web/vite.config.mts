/// <reference types='vitest' />
import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
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
  plugins: [
    react(),
    tailwindcss(),
    iconSetsPlugin(fileURLToPath(new URL('./public/icons', import.meta.url))),
    VitePWA({
      registerType: 'autoUpdate',
      // Deep links work offline: anything not in the cache falls back to the app shell.
      manifest: {
        name: 'FinancePal',
        short_name: 'FinancePal',
        description: 'Personal and shared budgets: accounts, categories and transactions.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android cuts its own shape out of this one, so the mark sits well inside it.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell, and only the shell: the icon chunks and sets are thousands of files that
        // would otherwise all be downloaded on the first visit.
        globPatterns: ['index.html', 'assets/index-*.{js,css}', 'assets/*.woff2', '*.png', 'favicon.ico'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Reading the ledger offline: the last answer stands in when the network doesn't come.
            // Sign-in and refresh are left out — a stale token answer would be worse than an error.
            urlPattern: ({ url, request }) => request.method === 'GET' && /\/api\//.test(url.pathname) && !url.pathname.includes('/api/auth/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ft-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Icon sets: generated files that only change with a release.
            urlPattern: ({ url }) => url.pathname.includes('/icons/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ft-icon-sets',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The lazily loaded chunks, an icon at a time: keep what's been used, refresh quietly.
            urlPattern: ({ url }) => url.pathname.includes('/assets/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ft-assets',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
      },
    }),
  ],
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
