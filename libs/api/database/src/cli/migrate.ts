// First line, same reasoning as apps/api/src/main.ts: the imports below resolve (and their
// top-level code runs) before anything else in this file, so createMigrationDataSource must
// not read process.env.MIGRATION_DATABASE_URL/DATABASE_URL until dotenv has populated it.
import 'dotenv/config';
import { createMigrationDataSource } from '../data-source.js';
import { migrations, migrateUp } from '../migrations/index.js';

async function main(): Promise<void> {
  // Deliberately not the runtime dataSource: migrations need the schema owner, which
  // bypasses RLS. Running them as the app's RLS-bound role would silently skip rows.
  const dataSource = createMigrationDataSource();
  await dataSource.initialize();
  try {
    await migrateUp(dataSource, migrations);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
