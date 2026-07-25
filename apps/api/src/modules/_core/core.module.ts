import { Module } from '@nestjs/common';
import { TsRestModule } from '@ts-rest/nest';
import { HealthController } from './health/health.controller';

/**
 * Cross-cutting infrastructure: config, filters, interceptors, guards, decorators.
 * Feature modules may depend on this one; it must never depend on them.
 *
 * validateResponses makes a response that does not match its contract schema fail
 * in tests instead of silently reaching the client.
 */
@Module({
  imports: [TsRestModule.register({ validateResponses: true, isGlobal: true })],
  controllers: [HealthController],
})
export class CoreModule {}
