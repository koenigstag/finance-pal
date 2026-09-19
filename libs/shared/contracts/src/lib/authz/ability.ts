import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

export const MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// Ledger resources all share one rule: writable by anyone except a viewer, in a group that
// isn't archived. Listed explicitly rather than using 'all' so adding a subject is a
// deliberate act, not something that silently inherits write access.
export const LEDGER_SUBJECTS = ['Account', 'AccountTarget', 'Category', 'Tag', 'Transaction', 'RecurringRule'] as const;

export type Subject =
  | (typeof LEDGER_SUBJECTS)[number]
  | 'Group'
  | 'GroupMember'
  | 'Profile'
  // Not ledger data — a note someone schedules for the group, which says nothing about money.
  | 'ScheduledNotification'
  | 'all';

export type Action =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'manage'
  // Group lifecycle operations that aren't plain CRUD and carry their own rules.
  | 'archive'
  | 'restore'
  | 'transferOwnership';

export type AppAbility = MongoAbility<[Action, Subject]>;

export interface GroupContext {
  role: MemberRole;
  archived: boolean;
}

/**
 * The single source of truth for "who may do what" inside one group.
 *
 * Lives in shared-contracts on purpose: the API enforces these rules, and the PWA imports the
 * same function to decide what to disable in the UI. Two implementations of the same rules
 * would drift.
 *
 * This is only the permission layer. It deliberately does not — and cannot — enforce which
 * *rows* a caller can reach; that guarantee comes from Postgres RLS policies, which apply even
 * to a query that forgets its group filter entirely.
 */
export function defineAbilityFor(ctx: GroupContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Every member of a group can read everything in it, viewers included.
  can('read', 'all');

  if (ctx.archived) {
    // An archived group is read-only for everyone, including its owner — the only way out is
    // to restore it first.
    if (ctx.role === 'owner') {
      // Deleting stays possible too: it's how an owner gets rid of an old group for good.
      can(['restore', 'delete'], 'Group');
    }
    return build();
  }

  if (ctx.role !== 'viewer') {
    can(['create', 'update', 'delete'], [...LEDGER_SUBJECTS]);
    // The same rule as the ledger's, spelled out because it isn't one of its subjects: whoever
    // may record money in this group may schedule a note about it, and call one off. There is no
    // update — a note is a sentence and a moment, and changing either is a new one.
    can(['create', 'delete'], 'ScheduledNotification');
  }

  if (ctx.role === 'owner' || ctx.role === 'admin') {
    can('manage', 'GroupMember');
  }

  if (ctx.role === 'owner') {
    can(['update', 'archive', 'delete', 'transferOwnership'], 'Group');
  }

  return build();
}
