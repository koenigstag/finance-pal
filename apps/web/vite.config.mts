/// <reference types='vitest' />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { iconSetsPlugin } from '../../tools/icon-sets.mjs';

// Where the API runs in development. Both REST and Socket.io are proxied through the Vite dev
// server, so the browser only ever talks to its own origin and the API needs no CORS setup.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The commit this bundle is built from, for the About dialog: the CI variable where there is one
// (the deploy checkout is shallow, but it still sets it), the checkout's own HEAD otherwise, and
// nothing at all where there is no git to ask — a source tarball, a container without the history.
function headCommit() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  // The path the app is served under: "/" by default, the repository path on a GitHub Pages
  // project site (set by the deploy workflow).
  base: process.env.VITE_BASE_PATH ?? '/',
  cacheDir: '../../node_modules/.vite/apps/web',
  // Frozen into the bundle, because a built app can't read package.json or run git: see
  // lib/build-info.ts, which is the only place that reads them. The commit is not a file, so the
  // build target names GITHUB_SHA among its cache inputs (apps/web/package.json) — without that,
  // a cached build could ship a bundle claiming a hash from some other commit.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(headCommit()),
  },
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
      // The worker waits instead of taking over; the app applies it while starting, and only
      // then — see features/pwa/app-updater.tsx.
      registerType: 'prompt',
      // Deep links work offline: anything not in the cache falls back to the app shell.
      manifest: {
        name: 'Finance Pal',
        short_name: 'Finance Pal',
        description: 'Personal and shared budgets: accounts, categories and transactions.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        // The splash and the system bars while it starts: the app's own dark background, which
        // suits a launch at night and never flashes white. The meta tags in index.html still
        // follow the system theme once it is running.
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android cuts its own shape out of this one, so the mark sits well inside it.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Notifications are the app's own part of the worker; everything else in it is Workbox's.
        // Copied from public/ to the site root, next to sw.js, so this relative path resolves
        // under a project path on GitHub Pages as well as at a domain root.
        importScripts: ['push-handler.js'],
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
