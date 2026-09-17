// Contract paths already start with /api, so this is only the origin in front of them. Empty means
// same origin: the dev server's proxy, or a deployment that serves the app and the API together.
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
