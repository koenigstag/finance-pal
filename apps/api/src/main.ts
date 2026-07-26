// Must run before anything else: AppModule's tree transitively imports @ft/api-database's
// data-source.ts, which reads DATABASE_URL from process.env at module-evaluation time — before
// any NestJS bootstrap code (including ConfigModule) gets a chance to run.
import 'dotenv/config';
import { DatabaseModule } from './modules/_core/database/database.module';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Must run before NestFactory.create() — see DatabaseModule.init() for why.
  DatabaseModule.init();

  const app = await NestFactory.create(AppModule);

  // No global prefix here on purpose: every route path, including the /api prefix,
  // is declared in the ts-rest contracts so the client derives it from the same source.
  const port = process.env.PORT || 3000;
  await app.listen(port);

  Logger.log(`Application is running on: http://localhost:${port}/api`);
}

bootstrap();
