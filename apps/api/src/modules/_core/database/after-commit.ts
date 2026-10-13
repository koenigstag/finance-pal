import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';
import { runOnTransactionCommit } from 'typeorm-transactional';

// What a write announces once it's kept — a live update, a push notification — waits for the
// transaction it was made in to commit. A part of a request that may be taken back on its own (a
// change an assistant asks for, or only tries out) runs in a savepoint, inside the request's
// transaction: what it announces then waits for the request's commit too, and goes nowhere if the
// savepoint is rolled back.

// The announcements a savepoint has made so far, while one runs.
const pending = new AsyncLocalStorage<(() => void)[]>();

let savepoints = 0;

/** Runs `announce` once the current transaction commits, and not at all if it doesn't. */
export function afterCommit(announce: () => void): void {
  const queue = pending.getStore();
  if (queue) {
    queue.push(announce);
  } else {
    runOnTransactionCommit(announce);
  }
}

/**
 * Runs `work` in a savepoint of the transaction `manager` is in: kept when `keep` says so of what it
 * returned, and rolled back otherwise — what it wrote then never was, though it still returns. A
 * throw rolls it back too, and is thrown on.
 *
 * The savepoint is set by hand, on the request's own connection: typeorm-transactional's NESTED
 * propagation opens a second transaction on another connection instead, outside the request's — and
 * outside its RLS user.
 */
export async function inSavepoint<T>(manager: EntityManager, work: () => Promise<T>, keep: (result: T) => boolean): Promise<T> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('A savepoint needs a transaction to be in');
  }
  const name = `kept_${++savepoints}`;
  const queue: (() => void)[] = [];
  await manager.query(`SAVEPOINT ${name}`);
  let result: T;
  try {
    result = await pending.run(queue, work);
  } catch (error) {
    await manager.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await manager.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
  if (!keep(result)) {
    await manager.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await manager.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  }
  await manager.query(`RELEASE SAVEPOINT ${name}`);
  // Back in the request's transaction: it commits or rolls back what was kept along with the rest.
  queue.forEach((announce) => afterCommit(announce));
  return result;
}
