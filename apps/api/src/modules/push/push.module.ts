import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Currency, Profile, PushSubscription } from '@ft/api-database';
import { PushController } from './push.controller';
import { PushNotificationsService } from './push-notifications.service';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

// Notifications for a closed app, next to realtime's live updates for an open one. Feature
// modules take PushNotificationsService and say what happened; nothing else here is theirs.
@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, Profile, Currency])],
  controllers: [PushController],
  providers: [PushSenderService, PushSubscriptionsService, PushNotificationsService],
  exports: [PushNotificationsService],
})
export class PushModule {}
