import type { QueryKey } from '@tanstack/react-query';
import type { RealtimeEvent } from '@ft/shared-contracts';
import { queryKeys, startsWith } from '@/lib/query-keys';

/**
 * What a change makes stale: every query under one of the `refresh` prefixes, except those under
 * one of the `skip` prefixes.
 */
export interface Invalidation {
  refresh: QueryKey[];
  skip: QueryKey[];
}

/** Whether an invalidation reaches the query with this key. */
export function reaches({ refresh, skip }: Invalidation, queryKey: QueryKey): boolean {
  return refresh.some((prefix) => startsWith(queryKey, prefix)) && !skip.some((prefix) => startsWith(queryKey, prefix));
}

/** Several invalidations as one: what any of them refreshes, less what any of them skips. */
export function mergeInvalidations(invalidations: Invalidation[]): Invalidation {
  return {
    refresh: invalidations.flatMap((invalidation) => invalidation.refresh),
    skip: invalidations.flatMap((invalidation) => invalidation.skip),
  };
}

/**
 * The cached answers a `ledger:changed` event may have changed. The event only names what
 * changed, so this refetches what the same change invalidates when it's made in this tab (see the
 * features' queries.ts), plus whatever else the one event stands in for.
 */
export function invalidationFor({ resourceType, resourceId, action, groupId }: RealtimeEvent): Invalidation {
  switch (resourceType) {
    case 'Transaction':
      // Money moved: the list, and the balances (and usage counts) under accounts.
      return refresh(queryKeys.transactions(groupId), queryKeys.accounts(groupId));
    case 'RecurringRule':
      // One event however many occurrences the rule added or dropped. No list of rules is cached yet.
      return refresh(queryKeys.transactions(groupId), queryKeys.accounts(groupId));
    case 'Account':
      // A deleted account takes its transactions and recurring rules with it, and its transfers out
      // of other accounts' balances; any other change to one stays among the accounts.
      return action === 'deleted'
        ? afterDelete(groupId, queryKeys.accountUsage(groupId, resourceId))
        : refresh(queryKeys.accounts(groupId));
    case 'AccountTarget':
      // Nothing caches targets yet; they would sit with their account.
      return refresh(queryKeys.accounts(groupId));
    case 'Category':
      if (action === 'deleted') {
        // Its transactions and recurring rules lost it.
        return afterDelete(groupId, queryKeys.categoryUsage(groupId, resourceId));
      }
      // An update may have moved it under another parent, which re-files its transactions.
      return action === 'updated'
        ? refresh(queryKeys.categories(groupId), queryKeys.transactions(groupId))
        : refresh(queryKeys.categories(groupId));
    case 'Tag':
      // No list of tags is cached yet. Transactions carry tag ids, and a deleted tag drops out of them.
      return action === 'deleted' ? refresh(queryKeys.transactions(groupId)) : refresh();
    case 'Group':
      // The groups list carries the name, the archived state and the caller's role. A deleted
      // group's own queries are left alone: refetching them could only 404, and its pages close
      // once the list no longer has it.
      return action === 'deleted'
        ? { refresh: [queryKeys.groups], skip: [queryKeys.group(groupId)] }
        : refresh(queryKeys.groups);
    case 'GroupMember':
      // The groups list carries the caller's own role, and gains a group they were just added to.
      return refresh(queryKeys.members(groupId), queryKeys.groups);
  }
}

function refresh(...prefixes: QueryKey[]): Invalidation {
  return { refresh: prefixes, skip: [] };
}

// As invalidateGroupAfterDelete does in the tab that deleted: all of the group, except the deleted
// item's usage query, which a confirmation dialog may still be showing — refetching it would 404.
function afterDelete(groupId: string, deletedUsageKey: QueryKey): Invalidation {
  return { refresh: [queryKeys.group(groupId)], skip: [deletedUsageKey] };
}
