import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api/client';
import { tokenStore, type Session } from '@/lib/api/token-store';
import { queryClient } from '@/lib/query-client';

/** The current session, re-rendering on login, logout and token changes — in any tab. */
export function useSession(): Session | null {
  return useSyncExternalStore(tokenStore.subscribe, tokenStore.get);
}

export async function logout(): Promise<void> {
  const session = tokenStore.get();
  tokenStore.clear();
  // Cached data belongs to the user who just left; the next one must not see it even briefly.
  queryClient.clear();
  if (session) {
    // Best effort: revokes this refresh token server-side. The local session is already gone,
    // and the endpoint answers 204 even for a token it doesn't recognize.
    await api.auth.logout({ body: { refreshToken: session.refreshToken } }).catch(() => undefined);
  }
}
