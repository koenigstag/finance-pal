import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { GroupsModule } from './modules/groups/groups.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RecurringModule } from './modules/recurring/recurring.module';

@Module({
  imports: [CoreModule, AuthModule, GroupsModule, LedgerModule, RealtimeModule, RecurringModule],
})
export class AppModule {}
