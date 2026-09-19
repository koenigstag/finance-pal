/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  // Origin of the API for builds served somewhere else (e.g. GitHub Pages), like
  // "https://api.example.com". Unset in development, where Vite proxies /api on the same origin.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build-time facts, replaced by Vite's `define` (see vite.config.mts). Read them through
// lib/build-info.ts rather than here, so a build with nothing to report has one place to say so.

/** The app's version, from its package.json. */
declare const __APP_VERSION__: string;

/** The full hash of the commit the bundle was built from, or '' when git had nothing to say. */
declare const __APP_COMMIT__: string;
