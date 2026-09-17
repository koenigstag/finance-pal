import { autorun } from 'mobx';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEY, SessionStore, type Session } from './session-store';

const session = (n: number): Session => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  user: { id: 'u1', email: 'a@example.com' },
});

describe('SessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores a stored session on creation', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(1)));
    expect(new SessionStore().session).toEqual(session(1));
  });

  it('persists login, token rotation and logout', () => {
    const store = new SessionStore();
    store.set(session(1));
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null')).toEqual(session(1));

    store.updateTokens('access-2', 'refresh-2');
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null')).toEqual(session(2));

    store.clear();
    expect(store.isSignedIn).toBe(false);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('does not invent a session when rotating without one', () => {
    expect(new SessionStore().updateTokens('a', 'r')).toBeNull();
  });

  it("picks up another tab's change from the storage event and notifies observers", () => {
    const store = new SessionStore();
    const seen: (string | undefined)[] = [];
    const stop = autorun(() => seen.push(store.session?.accessToken));

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(3)));
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
    localStorage.removeItem(SESSION_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));

    expect(seen).toEqual([undefined, 'access-3', undefined]);
    stop();
  });

  it('syncFromStorage reads storage directly, ahead of the storage event', () => {
    const store = new SessionStore();
    store.set(session(1));
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session(2)));

    expect(store.session).toEqual(session(1));
    expect(store.syncFromStorage()).toEqual(session(2));
    expect(store.session).toEqual(session(2));
  });
});
