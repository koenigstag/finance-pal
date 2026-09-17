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

const STORAGE_KEY = 'ft.session';

type Listener = () => void;
const listeners = new Set<Listener>();

// Parsed once per change, not per read: useSyncExternalStore compares snapshots by reference,
// so get() must keep returning the same object until the session actually changes.
let current: Session | null = read();

function read(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

// Both tokens live in localStorage by explicit product decision. That makes them readable by any
// script running on this origin, so the app must never render untrusted HTML.
export const tokenStore = {
  get(): Session | null {
    return current;
  },

  /**
   * Re-reads storage directly instead of trusting the in-memory copy. The copy only catches up
   * with other tabs when their `storage` event is delivered, and nothing orders that event
   * relative to, say, being granted a Web Lock another tab just released — code that must see
   * the latest tokens right now (token refresh) has to read storage itself.
   */
  getFresh(): Session | null {
    const fresh = read();
    if (fresh?.accessToken !== current?.accessToken || fresh?.refreshToken !== current?.refreshToken) {
      current = fresh;
      emit();
    }
    return current;
  },

  set(session: Session): void {
    current = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    emit();
  },

  updateTokens(accessToken: string, refreshToken: string): Session | null {
    if (!current) {
      return null;
    }
    const next = { ...current, accessToken, refreshToken };
    tokenStore.set(next);
    return next;
  },

  clear(): void {
    current = null;
    localStorage.removeItem(STORAGE_KEY);
    emit();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Another tab logging in, out, or rotating tokens writes the same key; the `storage` event only
// fires in the *other* tabs, which is exactly where the in-memory copy would otherwise go stale.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    current = read();
    emit();
  }
});
