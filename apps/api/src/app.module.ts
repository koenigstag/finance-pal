import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthModule } from './modules/auth/auth.module';
import { GroupsModule } from './modules/groups/groups.module';
import { ImportModule } from './modules/import/import.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RecurringModule } from './modules/recurring/recurring.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    ApiKeysModule,
    GroupsModule,
    ImportModule,
    LedgerModule,
    RealtimeModule,
    RecurringModule,
  ],
})
export class AppModule {}
