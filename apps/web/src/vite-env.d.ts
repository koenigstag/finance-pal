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
