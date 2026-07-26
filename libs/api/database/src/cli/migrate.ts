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
