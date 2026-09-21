import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TsRestModule } from '@ts-rest/nest';
import { AppConfigModule } from './config/app-config.module';
import { AuthnModule } from './authn/authn.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { RlsContextInterceptor } from './rls/rls-context.interceptor';

/**
 * Cross-cutting infrastructure: config, filters, interceptors, guards, decorators.
 * Feature modules may depend on this one; it must never depend on them.
 *
 * validateResponses makes a response that does not match its contract schema fail
 * in tests instead of silently reaching the client.
 */
@Module({
  imports: [
    AppConfigModule,
    AuthnModule,
    DatabaseModule,
    // Registered once for the whole app: forRoot() sets up one orchestrator, and a second
    // registration would run every @Cron twice. Two modules have jobs now — the recurring
    // scheduler and the one that sends scheduled notifications — so it moved here, to the
    // infrastructure they both sit on.
    ScheduleModule.forRoot(),
    TsRestModule.register({ validateResponses: true, isGlobal: true }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RlsContextInterceptor },
  ],
})
export class CoreModule {}
