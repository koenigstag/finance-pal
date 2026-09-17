import { makeAutoObservable, observableRef } from 'mobx';

export interface SessionUser {
  id: string;
  email: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  // Kept alongside the tokens because the API has no "who am I" endpoint to ask after a reload.
  user: SessionUser;
}

export const SESSION_STORAGE_KEY = 'ft.session';

/**
 * The signed-in session, persisted to localStorage and kept in sync across tabs.
 *
 * Both tokens live in localStorage by explicit product decision. That makes them readable by any
 * script running on this origin, so the app must never render untrusted HTML.
 */
export class SessionStore {
  // Replaced as a whole, never mutated in place: a ref is enough, no deep observability needed.
  session: Session | null = null;

  constructor() {
    makeAutoObservable(this, { session: observableRef }, { autoBind: true });
    this.session = readStoredSession();

    // Another tab logging in, out, or rotating tokens writes the same key; the `storage` event
    // only fires in the *other* tabs, which is exactly where this copy would otherwise go stale.
    window.addEventListener('storage', (event) => {
      if (event.key === SESSION_STORAGE_KEY || event.key === null) {
        this.replace(readStoredSession());
      }
    });
  }

  get isSignedIn(): boolean {
    return this.session !== null;
  }

  set(session: Session): void {
    this.session = session;
    writeStoredSession(session);
  }

  updateTokens(accessToken: string, refreshToken: string): Session | null {
    if (!this.session) {
      return null;
    }
    const next = { ...this.session, accessToken, refreshToken };
    this.set(next);
    return next;
  }

  clear(): void {
    this.session = null;
    writeStoredSession(null);
  }

  /**
   * Re-reads storage instead of trusting the in-memory copy. The copy only catches up with other
   * tabs when their `storage` event is delivered, and nothing orders that event relative to, say,
   * being granted a Web Lock another tab just released — code that must see the latest tokens
   * right now (token refresh) has to read storage itself.
   */
  syncFromStorage(): Session | null {
    const stored = readStoredSession();
    if (stored?.accessToken !== this.session?.accessToken || stored?.refreshToken !== this.session?.refreshToken) {
      this.replace(stored);
    }
    return this.session;
  }

  private replace(session: Session | null): void {
    this.session = session;
  }
}

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: Session | null): void {
  try {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: the session still works for this page load.
  }
}
