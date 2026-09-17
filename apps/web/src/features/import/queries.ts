import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_ORIGIN } from '@/lib/api/api-url';
import { ApiError } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { refreshSession } from '@/lib/api/refresh';
import { queryKeys } from '@/lib/query-keys';
import { rootStore } from '@/stores/root-store';

export interface ImportSummary {
  groupId: string;
  groupName: string;
  accounts: number;
  categories: number;
  transactions: number;
  plannedTransactions: number;
  openingBalances: number;
  // Balances as the app shows them (planned transactions left out), for checking against the app
  // the data came from.
  balances: { name: string; currency: string; balance: string }[];
}

/**
 * Uploads a 1Money backup, which becomes a new group named after the file.
 *
 * The endpoint takes a file rather than JSON, so it doesn't go through the ts-rest client; the
 * token handling here mirrors what that client does, refresh included.
 */
export function useImportOneMoney() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => postBackup(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

async function postBackup(file: File): Promise<ImportSummary> {
  const body = new FormData();
  body.append('file', file);

  const session = rootStore.session.session;
  let response = await send(body, session?.accessToken);
  if (response.status === 401 && session) {
    const refreshed = await refreshSession(session.accessToken);
    if (refreshed) {
      response = await send(body, refreshed.accessToken);
    }
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  return payload as ImportSummary;
}

function send(body: FormData, accessToken: string | undefined): Promise<Response> {
  return fetch(`${API_ORIGIN}/api/import/1money`, {
    method: 'POST',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    body,
  });
}

export { ApiError };
