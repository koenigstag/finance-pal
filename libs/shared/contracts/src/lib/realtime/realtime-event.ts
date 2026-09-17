import { z } from 'zod';

// Not a ts-rest contract — this travels over a Socket.io event, not HTTP. Lives here anyway so
// the future PWA imports the same shape instead of hand-rolling a matching one.
export const LEDGER_CHANGED_EVENT = 'ledger:changed';

export const REALTIME_RESOURCE_TYPES = [
  'Account',
  'AccountTarget',
  'Category',
  'Tag',
  'Transaction',
  // One event per rule change, not one per occurrence it materialized — a client should refresh
  // rules, transactions and account balances together when it sees this.
  'RecurringRule',
  'Group',
  'GroupMember',
] as const;
export type RealtimeResourceType = (typeof REALTIME_RESOURCE_TYPES)[number];

export const REALTIME_ACTIONS = ['created', 'updated', 'deleted', 'archived', 'restored'] as const;
export type RealtimeAction = (typeof REALTIME_ACTIONS)[number];

// Deliberately a minimal invalidation signal, not the changed row itself: the client refetches
// over the existing REST + RLS path rather than trusting a resource payload pushed over the
// socket. Keeps this contract small and gives RLS exactly one enforcement point to reason about.
export const realtimeEventSchema = z.object({
  resourceType: z.enum(REALTIME_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  action: z.enum(REALTIME_ACTIONS),
  groupId: z.string().uuid(),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
