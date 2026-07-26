import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [CoreModule, AuthModule],
})
export class AppModule {}
