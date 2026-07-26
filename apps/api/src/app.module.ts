import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { GroupsModule } from './modules/groups/groups.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [CoreModule, AuthModule, GroupsModule, LedgerModule, RealtimeModule],
})
export class AppModule {}
