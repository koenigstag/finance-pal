import { rootStore } from '@/stores/root-store';
import type { Session } from '@/stores/session-store';
import { API_ORIGIN } from './api-url';

const LOCK_NAME = 'ft-token-refresh';

// Refresh tokens rotate, and the API treats a second use of an already-rotated token as theft:
// it revokes the whole token family and every tab is logged out. So a refresh must never run
// twice for the same token — not from two requests in one tab, and not from two tabs at once.
//
// Two layers make that hold:
// - within a tab, concurrent callers share one in-flight promise;
// - across tabs, the refresh runs under a Web Lock, and whoever gets the lock second re-reads
//   storage first: if the access token already changed, another tab refreshed and there is
//   nothing left to do.

let inFlight: Promise<Session | null> | null = null;

/**
 * Returns a session whose access token is newer than `failedAccessToken`, refreshing only if
 * nobody else already has. Resolves to null when the session is gone (refresh rejected, or the
 * user logged out meanwhile); rejects on network/server errors without dropping the session.
 */
export function refreshSession(failedAccessToken: string): Promise<Session | null> {
  if (!inFlight) {
    inFlight = withCrossTabLock(() => refreshUnderLock(failedAccessToken)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  // Web Locks are in every current browser; the fallback only keeps tests (jsdom) and very old
  // browsers working, where the in-tab promise above is the remaining guard.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return fn();
}

async function refreshUnderLock(failedAccessToken: string): Promise<Session | null> {
  // Storage, not the in-memory copy: a tab that just released this lock after rotating may not
  // have had its `storage` event delivered here yet, and refreshing with the rotated-away token
  // would trip reuse detection.
  const session = rootStore.session.syncFromStorage();
  if (!session) {
    return null;
  }
  if (session.accessToken !== failedAccessToken) {
    // Rotated by another tab (or an earlier caller) while this one waited for the lock.
    return session;
  }

  const response = await fetch(`${API_ORIGIN}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  if (response.status === 401) {
    // Expired, revoked or reused: the session is over for every tab.
    rootStore.session.clear();
    return null;
  }
  if (!response.ok) {
    // A blip (5xx, proxy error) is not a reason to log the user out; let the caller surface it.
    throw new Error(`Token refresh failed with status ${response.status}`);
  }

  const { accessToken, refreshToken } = (await response.json()) as { accessToken: string; refreshToken: string };
  return rootStore.session.updateTokens(accessToken, refreshToken);
}
