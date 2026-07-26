import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TsRestModule } from '@ts-rest/nest';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

/**
 * Cross-cutting infrastructure: config, filters, interceptors, guards, decorators.
 * Feature modules may depend on this one; it must never depend on them.
 *
 * validateResponses makes a response that does not match its contract schema fail
 * in tests instead of silently reaching the client.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, TsRestModule.register({ validateResponses: true, isGlobal: true })],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class CoreModule {}
