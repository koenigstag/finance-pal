import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PushNotificationsService } from '../push/push-notifications.service';

// Every note whose moment has come, marked sent as it is taken — see the function's own comment
// in the migration for why claiming and marking are one statement.
const CLAIM_DUE_SQL = 'SELECT * FROM claim_due_notifications($1)';

interface DueNotification {
  notification_id: string;
  group_id: string;
  group_name: string;
  body: string;
}

/**
 * Sends the notes a group scheduled, at the moment they were scheduled for.
 *
 * Every minute, not the recurring scheduler's ten: somebody who picked 09:00 meant 09:00, and a
 * tick with nothing due is one indexed query against a partial index that only covers what is
 * still to come.
 *
 * It runs on the ordinary pool rather than a connection of its own, unlike the recurring
 * scheduler: claiming goes through a SECURITY DEFINER function, which needs no session, and
 * sending goes through PushNotificationsService, which reaches other people's devices the same
 * way. Nothing here holds a connection while it waits on a push service.
 *
 * No advisory lock either, for the same reason the claim is one statement: two instances ticking
 * at once cannot take the same note, because the second finds it already marked.
 */
@Injectable()
export class ScheduledNotificationsProcessorService {
  private readonly logger = new Logger(ScheduledNotificationsProcessorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly push: PushNotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'scheduled-notifications' })
  async tick(): Promise<void> {
    let due: DueNotification[];
    try {
      due = await this.dataSource.query(CLAIM_DUE_SQL, [new Date()]);
    } catch (error) {
      this.logger.error('Claiming scheduled notifications failed', error instanceof Error ? error.stack : error);
      return;
    }

    for (const notification of due) {
      try {
        await this.push.scheduledDueNow({
          id: notification.notification_id,
          groupId: notification.group_id,
          groupName: notification.group_name,
          text: notification.body,
        });
      } catch (error) {
        // Already claimed, so this one is not tried again: a note that buzzes twice is worse
        // than one that didn't arrive, and the group still has it in their list as sent.
        this.logger.error(
          `Sending scheduled notification ${notification.notification_id} failed`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    if (due.length > 0) {
      this.logger.log(`Sent ${due.length} scheduled notification(s)`);
    }
  }
}
