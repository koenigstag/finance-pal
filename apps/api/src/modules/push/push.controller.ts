import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { pushContract, type PushTopic } from '@ft/shared-contracts';
import type { PushSubscription } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { PushNotificationsService } from './push-notifications.service';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

function toSubscriptionDto(subscription: PushSubscription) {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    // Only ever written from the contract's list, by PushSubscriptionsService.
    topics: subscription.topics as PushTopic[],
    createdAt: subscription.createdAt.toISOString(),
    lastNotifiedAt: subscription.lastNotifiedAt?.toISOString() ?? null,
  };
}

/**
 * A device registering itself for notifications, and checking that they arrive. Everything here
 * is about the caller's own devices — what gets sent to them is decided by the app, never asked
 * for over HTTP.
 */
@Controller()
export class PushController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly sender: PushSenderService,
    private readonly notifications: PushNotificationsService,
  ) {}

  @TsRestHandler(pushContract.publicKey)
  publicKey() {
    return tsRestHandler(pushContract.publicKey, async () => ({
      status: 200 as const,
      body: { publicKey: this.sender.publicKey },
    }));
  }

  @TsRestHandler(pushContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(pushContract.list, async () => {
      const subscriptions = await this.subscriptions.listOwn(requireUser(user).id);
      return { status: 200 as const, body: subscriptions.map(toSubscriptionDto) };
    });
  }

  @TsRestHandler(pushContract.subscribe)
  subscribe(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(pushContract.subscribe, async ({ body }) => {
      const subscription = await this.subscriptions.register(requireUser(user).id, body);
      return { status: 200 as const, body: toSubscriptionDto(subscription) };
    });
  }

  @TsRestHandler(pushContract.unsubscribe)
  unsubscribe(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(pushContract.unsubscribe, async ({ body }) => {
      const removed = await this.subscriptions.remove(requireUser(user).id, body.endpoint);
      return { status: 200 as const, body: { removed } };
    });
  }

  @TsRestHandler(pushContract.test)
  test(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(pushContract.test, async () => {
      // 503 rather than a lie: the app only offers this where publicKey said push is set up, so
      // reaching it otherwise means the deployment changed under an open tab.
      if (!this.sender.isConfigured) {
        return { status: 503 as const, body: { statusCode: 503, message: 'Push notifications are not set up' } };
      }
      const sent = await this.notifications.test(requireUser(user).id);
      return { status: 200 as const, body: { sent } };
    });
  }
}
