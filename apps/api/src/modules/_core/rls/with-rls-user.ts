import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';

/**
 * Runs `fn` inside a short transaction with `app.current_user_id` set for that transaction only,
 * so Postgres RLS policies see who's asking. Shared by `RlsContextInterceptor` (which holds this
 * open for an entire HTTP request via `next.handle()`) and anything else that needs one RLS-aware
 * read/write without holding a connection open for longer than that single operation — a
 * long-lived WebSocket connection must never reuse the interceptor's "hold it open" pattern, or
 * it would pin a pooled connection for as long as the socket stays connected.
 */
export function withRlsUser<T>(dataSource: DataSource, userId: string | null, fn: () => Promise<T>): Promise<T> {
  return runInTransaction(async () => {
    // set_config(..., is_local => true) is the parameterizable equivalent of SET LOCAL; NULL is
    // passed through as an empty string, which app_current_user_id() maps back to NULL — the
    // unauthenticated case, and every policy denies it.
    await dataSource.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId ?? '']);
    return fn();
  });
}
