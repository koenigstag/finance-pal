import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { scheduledNotificationsContract } from '@ft/shared-contracts';
import type { ScheduledNotification } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { ScheduledNotificationsService } from './scheduled-notifications.service';

function toDto(notification: ScheduledNotification) {
  return {
    id: notification.id,
    groupId: notification.groupId,
    text: notification.text,
    sendAt: notification.sendAt.toISOString(),
    timezone: notification.timezone,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdBy: notification.createdBy,
    createdAt: notification.createdAt.toISOString(),
  };
}

@Controller()
export class ScheduledNotificationsController {
  constructor(private readonly notifications: ScheduledNotificationsService) {}

  @TsRestHandler(scheduledNotificationsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(scheduledNotificationsContract.list, async ({ params }) => {
      const scheduled = await this.notifications.list(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: scheduled.map(toDto) };
    });
  }

  @TsRestHandler(scheduledNotificationsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(scheduledNotificationsContract.create, async ({ params, body }) => {
      const scheduled = await this.notifications.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toDto(scheduled) };
    });
  }

  @TsRestHandler(scheduledNotificationsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(scheduledNotificationsContract.remove, async ({ params }) => {
      const scheduled = await this.notifications.remove(requireUser(user).id, params.groupId, params.notificationId);
      return { status: 200 as const, body: toDto(scheduled) };
    });
  }
}
