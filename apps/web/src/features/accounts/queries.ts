import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { accountsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { invalidateGroupAfterDelete, queryKeys } from '@/lib/query-keys';

export type Account = ClientInferResponseBody<typeof accountsContract.get, 200>;
export type CreateAccountBody = ClientInferRequest<typeof accountsContract.create>['body'];
export type UpdateAccountBody = ClientInferRequest<typeof accountsContract.update>['body'];

// Where each kind of account sits when they are offered in sections: what there is to spend with,
// then what is put aside, then what is owed — the order the accounts page reads in. A record of
// every kind rather than a list of some, so a kind added to the contract has to be given a place
// here instead of quietly going missing from the pickers.
const GROUP_RANK = { regular: 0, savings: 1, debt: 2 } as const satisfies Record<Account['type'], number>;

export interface AccountGroup {
  // Names the section: accounts.groups.<type>.
  type: Account['type'];
  accounts: Account[];
}

/**
 * The accounts under the sections a picker offers them in, sections with nothing in them left out
 * and the order the accounts came in kept within each.
 *
 * Debts come last. A debt account is money owed to or by someone rather than money to spend with,
 * so it is seldom the account a transfer is headed for, and a handful of them among the rest push
 * the accounts that usually are down out of reach.
 */
export function accountGroups(accounts: Account[]): AccountGroup[] {
  return (Object.keys(GROUP_RANK) as Account['type'][])
    .sort((a, b) => GROUP_RANK[a] - GROUP_RANK[b])
    .map((type) => ({ type, accounts: accounts.filter((account) => account.type === type) }))
    .filter((group) => group.accounts.length > 0);
}

/**
 * The group's accounts. Archived ones are left out unless asked for — they belong in the past, not
 * in a picker — and are cached apart, so a screen that wants them doesn't push them at the rest.
 */
export function useAccounts(groupId: string, includeArchived = false) {
  return useQuery({
    queryKey: includeArchived ? queryKeys.allAccounts(groupId) : queryKeys.accounts(groupId),
    queryFn: () => unwrap(api.accounts.list({ params: { groupId }, query: { includeArchived: includeArchived ? 'true' : undefined } }), 200),
  });
}

export function useAccountUsage(groupId: string, accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountUsage(groupId, accountId),
    queryFn: () => unwrap(api.accounts.usage({ params: { groupId, accountId } }), 200),
    enabled,
    // Counted fresh for every confirmation: a stale count is exactly what it must not show.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteAccount(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => unwrap(api.accounts.remove({ params: { groupId, accountId } }), 200),
    // Its transactions and recurring rules went with it, and other accounts' balances changed
    // with the transfers: everything cached for the group is suspect.
    onSuccess: (_, accountId) =>
      invalidateGroupAfterDelete(queryClient, groupId, queryKeys.accountUsage(groupId, accountId)),
  });
}

export function useSaveAccount(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accountId, body }: { accountId?: string; body: CreateAccountBody }) =>
      accountId
        ? unwrap(api.accounts.update({ params: { groupId, accountId }, body }), 200)
        : unwrap(api.accounts.create({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts(groupId) }),
  });
}
