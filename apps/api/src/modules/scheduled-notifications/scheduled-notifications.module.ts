import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledNotification } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { PushModule } from '../push/push.module';
import { ScheduledNotificationsController } from './scheduled-notifications.controller';
import { ScheduledNotificationsProcessorService } from './scheduled-notifications-processor.service';
import { ScheduledNotificationsService } from './scheduled-notifications.service';

// Notes a group schedules, and the job that sends them when their moment comes. One of the
// sources of notifications, like the ledger and the recurring scheduler — it says what happened
// and leaves the push module to decide whose devices hear about it.
@Module({
  imports: [TypeOrmModule.forFeature([ScheduledNotification]), AuthzModule, PushModule],
  controllers: [ScheduledNotificationsController],
  providers: [ScheduledNotificationsService, ScheduledNotificationsProcessorService],
})
export class ScheduledNotificationsModule {}
