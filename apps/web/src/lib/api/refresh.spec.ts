import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshSession } from './refresh';
import { tokenStore, type Session } from './token-store';

const user = { id: 'u1', email: 'a@example.com' };
const session = (n: number): Session => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, user });

const jsonResponse = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('refreshSession', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.clear();
    tokenStore.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rotates tokens with the current refresh token', async () => {
    tokenStore.set(session(1));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }));

    const result = await refreshSession('access-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ refreshToken: 'refresh-1' });
    expect(result).toEqual(session(2));
    expect(tokenStore.get()).toEqual(session(2));
  });

  it('refreshes once for concurrent callers in the same tab, and all get the new tokens', async () => {
    tokenStore.set(session(1));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }));

    const results = await Promise.all([refreshSession('access-1'), refreshSession('access-1'), refreshSession('access-1')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([session(2), session(2), session(2)]);
  });

  it('does not refresh when another tab already rotated the tokens in storage', async () => {
    tokenStore.set(session(1));
    // Another tab rotated and wrote storage, but its `storage` event hasn't reached this tab:
    // the in-memory copy still holds access-1.
    localStorage.setItem('ft.session', JSON.stringify(session(2)));
    expect(tokenStore.get()).toEqual(session(1));

    const result = await refreshSession('access-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(session(2));
  });

  it('ends the session when the refresh token is rejected', async () => {
    tokenStore.set(session(1));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, message: 'Refresh token reuse detected' }));

    expect(await refreshSession('access-1')).toBeNull();
    expect(tokenStore.get()).toBeNull();
    expect(localStorage.getItem('ft.session')).toBeNull();
  });

  it('keeps the session on a server error', async () => {
    tokenStore.set(session(1));
    fetchMock.mockResolvedValueOnce(jsonResponse(502));

    await expect(refreshSession('access-1')).rejects.toThrow('502');
    expect(tokenStore.get()).toEqual(session(1));
  });

  it('returns null without calling the API when there is no session', async () => {
    expect(await refreshSession('access-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs under a cross-tab Web Lock when the browser has one', async () => {
    tokenStore.set(session(1));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }));
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });

    await refreshSession('access-1');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('ft-token-refresh');
  });
});
