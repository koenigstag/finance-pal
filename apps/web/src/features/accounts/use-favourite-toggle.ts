import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { Account } from './queries';

// How long clicking has to stop before the last state is sent.
const SAVE_DELAY_MS = 500;

/** The accounts list with one account's favourite flag set; starring unstars the rest, as the API does. */
export function withFavourite(accounts: Account[], accountId: string, isFavourite: boolean): Account[] {
  return accounts.map((account) =>
    account.id === accountId ? { ...account, isFavourite } : isFavourite ? { ...account, isFavourite: false } : account,
  );
}

/**
 * One-click starring with a debounced save. Each click updates the cached accounts at once; the
 * API is called only after clicking stops, with the final state — and not at all when a burst of
 * clicks ends where it started. A failed save puts the list back as it was before the burst.
 */
export function useFavouriteToggle(groupId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.accounts(groupId);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; accountId: string; before: Account[] } | null>(null);

  return (accountId: string) => {
    const accounts = queryClient.getQueryData<Account[]>(key);
    const account = accounts?.find((candidate) => candidate.id === accountId);
    if (!accounts || !account) {
      return;
    }

    // A burst belongs to one account; clicking another account's star saves the first burst now.
    let before = accounts;
    if (pending.current) {
      clearTimeout(pending.current.timer);
      if (pending.current.accountId === accountId) {
        before = pending.current.before;
      } else {
        void save(pending.current.accountId, pending.current.before);
      }
    }

    const next = !account.isFavourite;
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<Account[]>(key, withFavourite(accounts, accountId, next));

    // Not cleared on unmount: closing the sheet right after a click must still save it.
    const timer = setTimeout(() => {
      pending.current = null;
      void save(accountId, before);
    }, SAVE_DELAY_MS);
    pending.current = { timer, accountId, before };
  };

  async function save(accountId: string, before: Account[]) {
    const current = queryClient.getQueryData<Account[]>(key)?.find((account) => account.id === accountId);
    const original = before.find((account) => account.id === accountId);
    if (!current || !original) {
      return;
    }
    if (current.isFavourite === original.isFavourite) {
      // Clicked back to where it started: nothing to send, but unstarring may have cleared another
      // account's flag in the cache along the way.
      queryClient.setQueryData(key, before);
      return;
    }
    try {
      await unwrap(api.accounts.update({ params: { groupId, accountId }, body: { isFavourite: current.isFavourite } }), 200);
    } catch {
      queryClient.setQueryData(key, before);
    } finally {
      await queryClient.invalidateQueries({ queryKey: key });
    }
  }
}
