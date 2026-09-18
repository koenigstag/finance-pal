import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER_CHANGED_EVENT, type RealtimeEvent } from '@ft/shared-contracts';
import { refreshSession } from '@/lib/api/refresh';
import { queryKeys } from '@/lib/query-keys';
import { SessionStore, type Session } from '@/stores/session-store';
import { BATCH_MS, RETRY_MS, SETTLE_MS, startRealtime } from './connection';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('@/lib/api/refresh', () => ({ refreshSession: vi.fn() }));

type Handler = (...args: unknown[]) => void;

/** Stands in for socket.io-client's socket; the test plays the server. */
class FakeSocket {
  auth: unknown;
  connected = false;
  // The token each connection attempt was made with.
  readonly attempts: string[] = [];
  private readonly handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  connect() {
    this.attempts.push((this.auth as { token: string }).token);
    return this;
  }

  disconnect() {
    if (this.connected) {
      this.drop('io client disconnect');
    }
    return this;
  }

  accept() {
    this.connected = true;
    this.emit('connect');
  }

  // What the gateway does with a token it can't verify: lets the connection open, then drops it.
  refuse() {
    this.accept();
    this.drop('io server disconnect');
  }

  drop(reason: string) {
    this.connected = false;
    this.emit('disconnect', reason);
  }

  send(payload: unknown) {
    this.emit(LEDGER_CHANGED_EVENT, payload);
  }

  private emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }
}

const groupId = '11111111-1111-4111-8111-111111111111';
const signedIn = (n: number): Session => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  user: { id: 'u1', email: 'a@example.com' },
});
const ledgerChanged = (resourceType: RealtimeEvent['resourceType']): RealtimeEvent => ({
  resourceType,
  resourceId: '33333333-3333-4333-8333-333333333333',
  action: 'created',
  groupId,
});

describe('startRealtime', () => {
  let socket: FakeSocket;
  let session: SessionStore;
  let queryClient: QueryClient;
  let stop: (() => void) | undefined;

  const cachedKeys: QueryKey[] = [
    queryKeys.profile,
    queryKeys.groups,
    queryKeys.accounts(groupId),
    queryKeys.categories(groupId),
    [...queryKeys.transactions(groupId), 'list', {}],
  ];
  const stale = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);

  const start = () => {
    stop = startRealtime(session, queryClient);
  };
  // Lets a renewal's awaited refresh settle.
  const settle = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    socket = new FakeSocket();
    vi.mocked(io).mockReturnValue(socket as unknown as Socket);
    vi.mocked(refreshSession).mockReset();
    session = new SessionStore();
    queryClient = new QueryClient();
    cachedKeys.forEach((key) => queryClient.setQueryData(key, []));
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it('connects with the access token once signed in, not before', () => {
    start();
    expect(socket.attempts).toEqual([]);

    session.set(signedIn(1));
    expect(socket.attempts).toEqual(['access-1']);
  });

  it('reconnects with the new token after the session refreshes', () => {
    session.set(signedIn(1));
    start();
    socket.accept();

    session.updateTokens('access-2', 'refresh-2');

    expect(socket.attempts).toEqual(['access-1', 'access-2']);
  });

  it('disconnects on logout, and drops the refetches still gathering', () => {
    session.set(signedIn(1));
    start();
    socket.accept();
    socket.send(ledgerChanged('Transaction'));

    session.clear();
    vi.advanceTimersByTime(BATCH_MS);

    expect(socket.connected).toBe(false);
    expect(socket.attempts).toEqual(['access-1']);
    expect(stale()).toEqual([]);
  });

  it('refetches what a burst of events makes stale, once, and skips a malformed one', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    session.set(signedIn(1));
    start();
    socket.accept();

    socket.send(ledgerChanged('Transaction'));
    socket.send(ledgerChanged('Category'));
    socket.send({ resourceType: 'Budget', groupId });
    expect(stale()).toEqual([]);

    vi.advanceTimersByTime(BATCH_MS);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(stale()).toEqual([
      queryKeys.accounts(groupId),
      queryKeys.categories(groupId),
      [...queryKeys.transactions(groupId), 'list', {}],
    ]);
  });

  it('refetches everything once a reconnection holds, having missed what happened meanwhile', () => {
    session.set(signedIn(1));
    start();
    socket.accept();
    vi.advanceTimersByTime(SETTLE_MS + BATCH_MS);
    expect(stale()).toEqual([]);

    socket.drop('transport close');
    socket.accept();
    vi.advanceTimersByTime(SETTLE_MS + BATCH_MS);

    expect(stale()).toEqual(cachedKeys);
  });

  it('renews a refused token and reconnects with the new one', async () => {
    vi.mocked(refreshSession).mockImplementation(async () => session.updateTokens('access-2', 'refresh-2'));
    session.set(signedIn(1));
    start();

    socket.refuse();
    await settle();

    expect(refreshSession).toHaveBeenCalledWith('access-1');
    expect(socket.attempts).toEqual(['access-1', 'access-2']);

    // The refused connection never counted, so the first one to hold isn't a reconnection.
    socket.accept();
    vi.advanceTimersByTime(SETTLE_MS + BATCH_MS);
    expect(stale()).toEqual([]);
  });

  it('stops renewing when even a fresh token is refused', async () => {
    vi.mocked(refreshSession).mockImplementation(async () => session.updateTokens('access-2', 'refresh-2'));
    session.set(signedIn(1));
    start();

    socket.refuse();
    await settle();
    socket.refuse();
    await settle();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(socket.attempts).toEqual(['access-1', 'access-2']);
  });

  it('tries the renewal again later when the API could not be reached', async () => {
    vi.mocked(refreshSession)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(async () => session.updateTokens('access-2', 'refresh-2'));
    session.set(signedIn(1));
    start();

    socket.refuse();
    await settle();
    expect(socket.attempts).toEqual(['access-1']);

    await vi.advanceTimersByTimeAsync(RETRY_MS);

    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(socket.attempts).toEqual(['access-1', 'access-2']);
  });
});
