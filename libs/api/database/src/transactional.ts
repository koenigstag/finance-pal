import {
  addTransactionalDataSource,
  initializeTransactionalContext as initTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';
import { dataSource } from './data-source.js';

// typeorm-transactional's own default is StorageDriver.CLS_HOOKED, not AsyncLocalStorage —
// cls-hooked's context propagation is unreliable across the Nest interceptor -> RxJS
// Observable -> ts-rest handler chain, and silently loses the active QueryRunner partway
// through a request (RLS then sees no transaction-scoped set_config and denies everything).
// Force ALS explicitly instead of relying on the library default.
export function initializeTransactionalContext(): void {
  initTransactionalContext({ storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE });
}

// Call initializeTransactionalContext() as the very first thing in the app entrypoint,
// before AppModule (or anything importing this module) is loaded — typeorm-transactional
// needs its AsyncLocalStorage context set up before any @Transactional() method can run.
export async function initializeDataSource() {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  addTransactionalDataSource(dataSource);
  return dataSource;
}
