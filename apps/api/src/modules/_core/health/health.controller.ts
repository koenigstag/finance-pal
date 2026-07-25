import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { healthContract } from '@ft/shared-contracts';

@Controller()
export class HealthController {
  @TsRestHandler(healthContract.check)
  check() {
    return tsRestHandler(healthContract.check, async () => ({
      status: 200 as const,
      body: { status: 'ok' as const, uptime: process.uptime() },
    }));
  }
}
