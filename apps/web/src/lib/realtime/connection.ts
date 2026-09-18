import type { QueryClient } from '@tanstack/react-query';
import { reaction } from 'mobx';
import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';
import { LEDGER_CHANGED_EVENT, realtimeEventSchema } from '@ft/shared-contracts';
import { API_ORIGIN } from '@/lib/api/api-url';
import { refreshSession } from '@/lib/api/refresh';
import type { SessionStore } from '@/stores/session-store';
import { invalidationFor, mergeInvalidations, reaches, type Invalidation } from './invalidation';

// Changes come in bursts (the recurring scheduler announces each rule it catches up on in turn),
// and every invalidation restarts a refetch still in flight: gathering a burst first refetches
// each query once rather than once per event.
export const BATCH_MS = 200;
// The server refuses a token by dropping the connection right after it opens, so a connection
// only counts once it has held this long.
export const SETTLE_MS = 1000;
// How soon to try again when renewing a refused token failed on the network or the server.
export const RETRY_MS = 5000;

// An empty prefix starts every key.
const EVERYTHING: Invalidation = { refresh: [[]], skip: [] };

/**
 * Keeps a Socket.io connection open while signed in, and refetches whatever a `ledger:changed`
 * event makes stale — so a change made elsewhere (by another member, on another device, or by an
 * automation through the external API) shows up without a reload. Returns a disposer.
 *
 * The server checks the access token only in the handshake, so the socket reconnects whenever the
 * session's token changes, and disconnects when the session ends.
 */
export function startRealtime(session: SessionStore, queryClient: QueryClient): () => void {
  const options: Partial<ManagerOptions & SocketOptions> = { autoConnect: false };
  // Without an origin, this page's own: in development the dev server proxies /socket.io.
  const socket = API_ORIGIN ? io(API_ORIGIN, options) : io(options);
  const batch = invalidationBatch(queryClient);

  // The access token the current connection was opened with.
  let token: string | null = null;
  // The token the last renewal here produced: its refusal can't be put down to expiry.
  let renewedToken: string | null = null;
  // Whether a connection has held since signing in, so that a later one may have missed events.
  let heldBefore = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  socket.on(LEDGER_CHANGED_EVENT, (payload: unknown) => {
    const event = realtimeEventSchema.safeParse(payload);
    // A shape this build doesn't know (from a newer API, say) is skipped rather than guessed at.
    if (event.success) {
      batch.add(invalidationFor(event.data));
    }
  });

  socket.on('connect', () => {
    settleTimer = setTimeout(() => {
      if (heldBefore) {
        // Whatever changed while the socket was away never reached it.
        batch.add(EVERYTHING);
      }
      heldBefore = true;
    }, SETTLE_MS);
  });

  socket.on('disconnect', (reason) => {
    clearTimeout(settleTimer);
    // Socket.io reconnects by itself unless one end hung up on purpose. The server does only to
    // refuse a token, usually one that expired while the socket was away (a phone asleep, a laptop
    // shut); the renewed token reconnects through the reaction below.
    if (reason === 'io server disconnect' && token) {
      void renew(token);
    }
  });

  async function renew(refused: string): Promise<void> {
    if (refused !== token) {
      // A retry that the session has moved on from: its current token already reconnected.
      return;
    }
    if (refused === renewedToken) {
      // Even a fresh token was refused, so expiry isn't why, and another refresh would only go
      // round in circles. Live updates stay off until the session's token next changes.
      return;
    }
    try {
      renewedToken = (await refreshSession(refused))?.accessToken ?? null;
    } catch {
      // The session still stands (see refreshSession); the API just couldn't be reached.
      retryTimer = setTimeout(() => void renew(refused), RETRY_MS);
    }
  }

  const stopReconnecting = reaction(
    () => session.session?.accessToken ?? null,
    (next) => {
      clearTimeout(retryTimer);
      socket.disconnect();
      token = next;
      if (next) {
        socket.auth = { token: next };
        socket.connect();
      } else {
        // Signed out: what's cached belongs to a session that has ended, and whoever signs in next
        // starts afresh.
        heldBefore = false;
        batch.cancel();
      }
    },
    { fireImmediately: true },
  );

  return () => {
    stopReconnecting();
    clearTimeout(retryTimer);
    socket.disconnect();
    batch.cancel();
  };
}

/** Gathers invalidations for BATCH_MS, then refetches every query they reach, once. */
function invalidationBatch(queryClient: QueryClient) {
  let pending: Invalidation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = [];
  };

  const flush = () => {
    const invalidation = mergeInvalidations(pending);
    cancel();
    void queryClient.invalidateQueries({ predicate: (query) => reaches(invalidation, query.queryKey) });
  };

  return {
    add(invalidation: Invalidation) {
      if (invalidation.refresh.length > 0) {
        pending.push(invalidation);
        timer ??= setTimeout(flush, BATCH_MS);
      }
    },
    cancel,
  };
}
