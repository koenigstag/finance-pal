import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { runOnTransactionCommit } from 'typeorm-transactional';
import { Currency, Profile, TransactionType } from '@ft/api-database';
import { renderPushMessage, topicFor, type PushMessage } from './push-messages';
import { PushSenderService, type PushTarget } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

export interface TransactionRecordedInput {
  groupId: string;
  groupName: string;
  // Whoever recorded it; they are the one member who doesn't hear about it.
  actorUserId: string;
  type: TransactionType;
  amount: string;
  currencyId: number;
}

export interface AddedToGroupInput {
  groupId: string;
  groupName: string;
  actorUserId: string;
  // The person who was added, the only one told.
  userId: string;
}

export interface ScheduledDueInput {
  id: string;
  groupId: string;
  groupName: string;
  text: string;
}

export interface PlannedRecordedInput {
  groupId: string;
  groupName: string;
  type: TransactionType;
  amount: string;
  currencyId: number;
}

/**
 * The one thing the rest of the app knows about push: it says what happened, and this decides
 * whether anyone hears about it, on which devices and in which words. The mirror of
 * RealtimeEmitterService, for the case the socket can't cover — nobody has the app open.
 *
 * Like that service, the work is deferred to `runOnTransactionCommit()`, so a rollback later in
 * the same request never produces a notification for money nobody spent. Unlike it, the work is
 * a network call to someone else's server: it is never awaited by the request, and a failure is
 * logged rather than raised. A missed notification is a nuisance; a transaction that fails to
 * save because a push service was down would be a bug.
 *
 * Nothing at all happens where no VAPID keys are configured, and that check comes first in every
 * method: a deployment without push pays for none of this, not even a query.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  // Currencies are seeded reference data that no request changes, so a code looked up once is
  // good for the life of the process.
  private readonly currencyCodes = new Map<number, string>();

  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    private readonly subscriptions: PushSubscriptionsService,
    private readonly sender: PushSenderService,
  ) {}

  /** A member recorded a transaction: everyone else in the group hears about it. */
  async transactionRecorded(input: TransactionRecordedInput): Promise<void> {
    if (!this.sender.isConfigured) {
      return;
    }
    const currency = await this.currencyCode(input.currencyId);
    if (!currency) {
      return;
    }

    const message: PushMessage = {
      kind: 'transaction.recorded',
      groupId: input.groupId,
      groupName: input.groupName,
      actor: await this.actorName(input.actorUserId),
      type: input.type,
      amount: input.amount,
      currency,
    };
    this.onCommit(() => this.deliverToGroup(input.groupId, input.actorUserId, message));
  }

  /** Someone was added to a group: they hear about it, the group doesn't. */
  async addedToGroup(input: AddedToGroupInput): Promise<void> {
    if (!this.sender.isConfigured) {
      return;
    }

    const message: PushMessage = {
      kind: 'member.added',
      groupId: input.groupId,
      groupName: input.groupName,
      actor: await this.actorName(input.actorUserId),
    };
    this.onCommit(() => this.deliverToUsers([input.userId], message));
  }

  /**
   * A planned transaction has come round and is part of the ledger now. Sent straight away rather
   * than on commit: the only caller is the recurring scheduler, which runs its own transactions
   * on its own connection and has already committed by the time it says so.
   */
  async plannedRecordedNow(input: PlannedRecordedInput): Promise<void> {
    if (!this.sender.isConfigured) {
      return;
    }
    const currency = await this.currencyCode(input.currencyId);
    if (!currency) {
      return;
    }

    await this.deliverToGroup(input.groupId, null, {
      kind: 'planned.recorded',
      groupId: input.groupId,
      groupName: input.groupName,
      type: input.type,
      amount: input.amount,
      currency,
    });
  }

  /**
   * A note somebody scheduled for the group has come round. Sent straight away, for the same
   * reason as a planned transaction's: its caller is a scheduler with its own transactions,
   * already committed by the time it says so.
   */
  async scheduledDueNow(input: ScheduledDueInput): Promise<void> {
    if (!this.sender.isConfigured) {
      return;
    }
    // Everyone in the group, whoever scheduled it included: they asked to be reminded too.
    await this.deliverToGroup(input.groupId, null, {
      kind: 'scheduled.due',
      id: input.id,
      groupId: input.groupId,
      groupName: input.groupName,
      text: input.text,
    });
  }

  /**
   * "Does this device get notifications?" — sent to every device its own owner has registered,
   * whatever topics they left switched on, and awaited so the answer can say how many push
   * services took it.
   */
  async test(userId: string): Promise<number> {
    const targets = await this.subscriptions.targetsForUsers([userId], null);
    return this.deliver(targets, { kind: 'push.test' });
  }

  // Commit hooks are fire-and-forget: nothing awaits this, and a rejection escaping here would
  // surface as an unhandled rejection long after the request it came from.
  private onCommit(deliver: () => Promise<unknown>): void {
    try {
      runOnTransactionCommit(() => {
        void deliver().catch((error: unknown) => {
          this.logger.error('Sending notifications failed', error instanceof Error ? error.stack : error);
        });
      });
    } catch (error) {
      // There is only a hook to hang this on inside a @Transactional() method, which every caller
      // is. A caller that one day isn't loses its notification and reads about it here — rather
      // than taking down the write the notification was only ever an echo of.
      this.logger.error('Could not schedule notifications', error instanceof Error ? error.stack : error);
    }
  }

  private async deliverToGroup(groupId: string, exceptUserId: string | null, message: PushMessage): Promise<number> {
    const targets = await this.subscriptions.targetsForGroup(groupId, exceptUserId, topicFor(message));
    return this.deliver(targets, message);
  }

  private async deliverToUsers(userIds: string[], message: PushMessage): Promise<number> {
    const targets = await this.subscriptions.targetsForUsers(userIds, topicFor(message));
    return this.deliver(targets, message);
  }

  /** Returns how many push services took the message. */
  private async deliver(targets: PushTarget[], message: PushMessage): Promise<number> {
    const results = await Promise.all(targets.map((target) => this.deliverOne(target, message)));
    return results.filter((result) => result === 'sent').length;
  }

  private async deliverOne(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'> {
    // Written for whoever receives it, not whoever set it off: two people in one group may well
    // read the app in different languages.
    const result = await this.sender.send(target, renderPushMessage(message, target.language));
    if (result !== 'failed') {
      await this.subscriptions.recordDelivery(target.subscriptionId, result === 'gone');
    }
    return result;
  }

  /**
   * What to call whoever set the change off. Their own profile, which is the only one RLS lets
   * their request read — so this has to happen here, while that request is still open, and not
   * with the rest of the notification after it commits.
   */
  private async actorName(userId: string): Promise<string | null> {
    const profile = await this.profiles.findOne({ where: { id: userId }, select: { id: true, displayName: true } });
    return profile?.displayName ?? null;
  }

  private async currencyCode(currencyId: number): Promise<string | null> {
    const cached = this.currencyCodes.get(currencyId);
    if (cached) {
      return cached;
    }
    // No RLS on currencies — global reference data — so this works after a commit too.
    const currency = await this.currencies.findOne({ where: { id: currencyId }, select: { id: true, code: true } });
    if (currency) {
      this.currencyCodes.set(currencyId, currency.code);
    }
    return currency?.code ?? null;
  }
}
