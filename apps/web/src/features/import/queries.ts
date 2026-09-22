import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_ORIGIN } from '@/lib/api/api-url';
import { deviceTimezone } from '@/lib/dates';
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
  // Repeating series, carried on as series.
  recurringRules: number;
  // Accounts opened with the balance the file gave them, having no transactions of their own.
  openingBalances: number;
  // Balances as the app shows them (planned transactions left out), for checking against the app
  // the data came from.
  balances: { name: string; currency: string; balance: string }[];
}

// A group comes out whole either way: as a workbook, or as a .zip of its tables as CSV files.
export type ExportFormat = 'xlsx' | 'csv';

/**
 * Files up and down don't go through the ts-rest client, which speaks JSON; this sends what it
 * would — the access token, refreshed once on a 401.
 */
async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (accessToken: string | undefined) =>
    fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers: accessToken ? { ...init.headers, authorization: `Bearer ${accessToken}` } : init.headers,
    });

  const session = rootStore.session.session;
  const response = await send(session?.accessToken);
  if (response.status !== 401 || !session) {
    return response;
  }
  const refreshed = await refreshSession(session.accessToken);
  return refreshed ? send(refreshed.accessToken) : response;
}

// Dates in a file carry no zone, so both ways they're read as this device's local time — the time
// the app shows them in.
function withTimezone(path: string, params: Record<string, string> = {}): string {
  return `${path}?${new URLSearchParams({ ...params, timezone: deviceTimezone() })}`;
}

async function postFiles(path: string, files: File[]): Promise<ImportSummary> {
  const body = new FormData();
  for (const file of files) {
    body.append('file', file);
  }
  const response = await authorizedFetch(withTimezone(path), { method: 'POST', body });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  return payload as ImportSummary;
}

/** Uploads a 1Money backup, which becomes a new group named after the file. */
export function useImportOneMoney() {
  const queryClient = useQueryClient();
  return useMutation({
    // 1Money's repeating entries fall due at local midnight, so they keep to this device's zone.
    mutationFn: (files: File[]) => postFiles('/api/import/1money', files.slice(0, 1)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

/** Uploads a Finance Pal workbook, .zip or CSV files of its tables, as a new group named after the file. */
export function useImportFinancePal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => postFiles('/api/import/finance-pal', files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

export interface ExportRequest {
  groupId: string;
  format: ExportFormat;
}

/** Downloads a group as a Finance Pal file, saved under the name the API gives it. */
export function useExportGroup() {
  return useMutation({
    mutationFn: async ({ groupId, format }: ExportRequest) => {
      const response = await authorizedFetch(withTimezone(`/api/groups/${groupId}/export`, { format }));
      if (!response.ok) {
        throw toApiError(response.status, await response.json().catch(() => null));
      }
      const fallback = format === 'csv' ? 'finance-pal.zip' : 'finance-pal.xlsx';
      saveFile(await response.blob(), fileNameOf(response.headers.get('content-disposition')) ?? fallback);
    },
  });
}

/** The file name a Content-Disposition header gives: the UTF-8 one where there is one. */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) {
    return null;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // A malformed escape: the plain name below will do.
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
}

// A download the browser saves as a file, the way a link to it would be.
function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later, not now: some browsers are still reading it when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export { ApiError };
