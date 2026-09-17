import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/query-client';
import { rootStore } from '@/stores/root-store';

export async function logout(): Promise<void> {
  const session = rootStore.session.session;
  rootStore.session.clear();
  // Cached data belongs to the user who just left; the next one must not see it even briefly.
  queryClient.clear();
  if (session) {
    // Best effort: revokes this refresh token server-side. The local session is already gone,
    // and the endpoint answers 204 even for a token it doesn't recognize.
    await api.auth.logout({ body: { refreshToken: session.refreshToken } }).catch(() => undefined);
  }
}
