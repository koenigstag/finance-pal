import { dataSource } from '../data-source.js';
import { migrations, migrateUp } from '../migrations/index.js';

async function main(): Promise<void> {
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
