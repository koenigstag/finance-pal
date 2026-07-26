import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { GroupsModule } from './modules/groups/groups.module';

@Module({
  imports: [CoreModule, AuthModule, GroupsModule],
})
export class AppModule {}
