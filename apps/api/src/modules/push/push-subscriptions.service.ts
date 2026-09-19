import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { PushSubscription } from '@ft/api-database';
import type { PushTopic } from '@ft/shared-contracts';
import type { PushTarget } from './push-sender.service';

export interface RegisterPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  topics: PushTopic[];
  userAgent?: string;
}

// find_push_targets and find_group_push_targets both return this shape; Postgres names columns
// in snake_case and the pg driver hands them over as it finds them.
interface TargetRow {
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: string;
}

/**
 * The rows behind push: a person's own devices, which they manage themselves, and the devices a
 * notification is going out to, which belong to other people.
 *
 * The split matters. Registering and unregistering happen inside the caller's own request, where
 * the RLS policy on push_subscriptions is exactly the rule we want — your devices, nobody
 * else's — so those go through the repository. Sending goes the other way round: the recipients
 * are by definition not the caller, and it happens after their transaction has committed, on a
 * connection with no app.current_user_id at all. Those three queries go through the SECURITY
 * DEFINER functions the table's migration installs, which are the only way past the policy and
 * take no device or topic from outside.
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(@InjectRepository(PushSubscription) private readonly subscriptions: Repository<PushSubscription>) {}

  /** Every device the caller has registered, newest first. Their own only — the policy sees to it. */
  async listOwn(userId: string): Promise<PushSubscription[]> {
    return this.subscriptions.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Registers this device, or updates what it's told about. Same call for both: a browser hands
   * out one endpoint per profile, so re-registering replaces that row rather than adding another.
   */
  @Transactional()
  async register(userId: string, input: RegisterPushSubscriptionInput): Promise<PushSubscription> {
    // Naming a topic twice is harmless and stored once.
    const topics = [...new Set(input.topics)];
    await this.subscriptions.query('SELECT claim_push_subscription($1, $2, $3, $4, $5, $6)', [
      userId,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      topics,
      input.userAgent ?? null,
    ]);

    // Read back rather than returned by the function: the row now belongs to the caller, so the
    // ordinary policy-checked path can see it, and the entity comes back mapped.
    const registered = await this.subscriptions.findOneBy({ endpoint: input.endpoint, userId });
    if (!registered) {
      throw new InternalServerErrorException('The push subscription could not be registered');
    }
    return registered;
  }

  /** Whether there was one to remove: unregistering a device twice is not an error. */
  async remove(userId: string, endpoint: string): Promise<boolean> {
    // The policy says the same thing, but the filter says it in code, as everywhere else here.
    const { affected } = await this.subscriptions.delete({ userId, endpoint });
    return (affected ?? 0) > 0;
  }

  /** The devices these people have registered for a topic; a null topic means all of them. */
  async targetsForUsers(userIds: string[], topic: PushTopic | null): Promise<PushTarget[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows: TargetRow[] = await this.subscriptions.query('SELECT * FROM find_push_targets($1, $2)', [userIds, topic]);
    return rows.map(toTarget);
  }

  /** The same for everyone in a group. */
  async targetsForGroup(groupId: string, topic: PushTopic | null): Promise<PushTarget[]> {
    const rows: TargetRow[] = await this.subscriptions.query('SELECT * FROM find_group_push_targets($1, $2)', [
      groupId,
      topic,
    ]);
    return rows.map(toTarget);
  }

  /** What the push service said: a device that is gone is deleted, one that took it is stamped. */
  async recordDelivery(subscriptionId: string, gone: boolean): Promise<void> {
    await this.subscriptions.query('SELECT record_push_delivery($1, $2)', [subscriptionId, gone]);
  }
}

function toTarget(row: TargetRow): PushTarget {
  return {
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    language: row.language,
  };
}
