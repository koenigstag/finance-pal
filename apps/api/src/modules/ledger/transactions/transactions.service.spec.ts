import type { Repository } from 'typeorm';
import type { Transaction, TransactionTag } from '@ft/api-database';
import { defineAbilityFor } from '@ft/shared-contracts';
import type { AbilityFactory } from '../../_core/authz/ability.factory';
import { TransactionsService, type ListTransactionsFilter } from './transactions.service';

// The decorator wants a registered data source; these tests have none, and nothing here depends on
// a real transaction.
jest.mock('typeorm-transactional', () => ({ Transactional: () => () => undefined }));

const GROUP = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const LOAN = '00000000-0000-4000-8000-000000000003';

// The WHERE that list() builds, as TypeORM would put it together: every condition after the first
// joined on with a bare AND, nothing wrapped in brackets for it.
async function whereOf(filter: ListTransactionsFilter): Promise<{ sql: string; params: Record<string, unknown> }> {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  const qb = {
    where: (sql: string, values?: Record<string, unknown>) => {
      conditions.push(sql);
      Object.assign(params, values);
      return qb;
    },
    andWhere: (sql: string, values?: Record<string, unknown>) => qb.where(sql, values),
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    getMany: async () => [],
  };
  const transactions = { createQueryBuilder: () => qb } as unknown as Repository<Transaction>;
  const transactionTags = { find: async () => [] } as unknown as Repository<TransactionTag>;
  const abilities = {
    forGroup: async () => ({ ability: defineAbilityFor({ role: 'member', archived: false }), groupName: 'Home' }),
  } as unknown as AbilityFactory;
  const unused = {} as never;
  const service = new TransactionsService(
    transactions,
    transactionTags,
    unused,
    unused,
    unused,
    unused,
    abilities,
    unused,
    unused,
    unused,
    unused,
  );

  await service.list(USER, GROUP, filter);
  return { sql: conditions.join(' AND '), params };
}

describe('TransactionsService.list', () => {
  it("finds an account's transactions on either side of a transfer", async () => {
    const { sql, params } = await whereOf({ accountId: LOAN });
    expect(sql).toContain('(t.account_id = :accountId OR t.to_account_id = :accountId)');
    expect(params).toMatchObject({ groupId: GROUP, accountId: LOAN });
  });

  // Unbracketed, the OR would be weighed after the AND before it: a transfer into the account
  // would match from any group at all.
  it('keeps the account filter inside the group', async () => {
    const { sql } = await whereOf({ accountId: LOAN, type: 'transfer' });
    expect(sql).toBe(
      't.group_id = :groupId AND (t.account_id = :accountId OR t.to_account_id = :accountId) AND t.type = :type',
    );
  });
});
