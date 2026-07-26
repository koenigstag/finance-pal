// Must run before anything else: AppModule's tree transitively imports @ft/api-database's
// data-source.ts, which reads DATABASE_URL from process.env at module-evaluation time — before
// any NestJS bootstrap code (including ConfigModule) gets a chance to run.
import 'dotenv/config';
import { DatabaseModule } from './modules/_core/database/database.module';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createMigrationDataSource, migrateUp, migrations } from '@ft/api-database';
import { AppModule } from './app.module';

// Dev convenience only: production deploys run migrations as an explicit, separate step
// (`pnpm run migrate`) before the app starts, not implicitly tied to whoever happens to
// launch the process. Uses the migration DataSource (schema owner, bypasses RLS) — entirely
// separate from the runtime pool DatabaseModule sets up below, so ordering between the two
// doesn't matter beyond "before the app starts accepting requests".
async function migrateIfDevelopment(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const migrationDataSource = createMigrationDataSource();
  await migrationDataSource.initialize();
  try {
    await migrateUp(migrationDataSource, migrations);
  } finally {
    await migrationDataSource.destroy();
  }
}

async function bootstrap() {
  await migrateIfDevelopment();

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
