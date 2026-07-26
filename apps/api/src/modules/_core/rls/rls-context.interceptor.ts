import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../authn/public.decorator';
import type { AuthenticatedRequest } from '../authn/request-user';

/**
 * Binds the authenticated user to the database session so Postgres RLS policies can see who
 * is asking, via current_setting('app.current_user_id').
 *
 * Everything downstream — the handler and every service it calls — runs inside one
 * transaction. That is not incidental: SET LOCAL is scoped to a transaction, whereas a plain
 * session-level SET would outlive the request and leak the previous caller's identity to
 * whoever next borrows that pooled connection.
 *
 * This is an interceptor rather than a guard because guards run *before* interceptors: a guard
 * querying the database would do so outside this transaction, with no app.current_user_id set,
 * and RLS would correctly hide everything from it. Any authorization step that needs to read
 * the database therefore has to live at interceptor level or deeper.
 *
 * Registered globally so no endpoint has to remember it, but @Public() routes are skipped:
 * they have no authenticated identity, so every policy would deny them anyway and the
 * transaction would buy nothing. That matters because a transaction is not free — it holds a
 * pooled connection for the entire request, including time spent on non-database work, and a
 * long-lived transaction keeps Postgres from vacuuming dead tuples. /api/health, hit
 * constantly by load balancers and touching no table at all, is the clearest example.
 *
 * Missing this interceptor fails closed, not open: with no app.current_user_id every policy
 * denies, so a route that slips through returns nothing rather than leaking anything.
 *
 * Consequence for phase 5: once register() also creates a profile and a group — both
 * RLS-protected — it will have to set app.current_user_id itself, since the identity only
 * comes into existence partway through that request and no token accompanies it.
 */
@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id ?? null;

    return from(
      runInTransaction(async () => {
        // set_config(..., is_local => true) is the parameterizable equivalent of SET LOCAL;
        // SET LOCAL itself takes no bind parameters, which would mean interpolating a value
        // straight into SQL. NULL is passed through as an empty string, which
        // app_current_user_id() maps back to NULL — that is the unauthenticated case, and
        // every policy denies it.
        await this.dataSource.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId ?? '']);

        // Awaiting the handler's final emission is what holds the transaction open for the
        // whole request, instead of committing the moment this interceptor returns.
        return await lastValueFrom(next.handle());
      }),
    );
  }
}
