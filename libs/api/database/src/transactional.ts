import { addTransactionalDataSource, initializeTransactionalContext } from 'typeorm-transactional';
import { dataSource } from './data-source.js';

export { initializeTransactionalContext };

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
