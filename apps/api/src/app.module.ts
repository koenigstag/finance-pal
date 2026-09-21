import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthModule } from './modules/auth/auth.module';
import { ExternalModule } from './modules/external/external.module';
import { GroupsModule } from './modules/groups/groups.module';
import { ImportModule } from './modules/import/import.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PushModule } from './modules/push/push.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RecurringModule } from './modules/recurring/recurring.module';
import { ScheduledNotificationsModule } from './modules/scheduled-notifications/scheduled-notifications.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    ApiKeysModule,
    ExternalModule,
    GroupsModule,
    ImportModule,
    LedgerModule,
    PushModule,
    RealtimeModule,
    RecurringModule,
    ScheduledNotificationsModule,
  ],
})
export class AppModule {}
