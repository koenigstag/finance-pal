import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { transactionsContract } from '@ft/shared-contracts';
import { Transaction } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { TransactionsService } from './transactions.service';

function toTransactionDto(transaction: Transaction, tagIds: string[]) {
  return {
    id: transaction.id,
    groupId: transaction.groupId,
    type: transaction.type,
    date: transaction.date.toISOString(),
    amount: transaction.amount,
    currencyId: transaction.currencyId,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    toAccountId: transaction.toAccountId,
    destAmount: transaction.destAmount,
    note: transaction.note,
    tagIds,
    recurringRuleId: transaction.recurringRuleId,
    recurrenceDate: transaction.recurrenceDate?.toISOString() ?? null,
    isCustomized: transaction.isCustomized,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

@Controller()
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @TsRestHandler(transactionsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(transactionsContract.list, async ({ params, query }) => {
      const page = await this.transactions.list(requireUser(user).id, params.groupId, query);
      return {
        status: 200 as const,
        body: {
          items: page.items.map((t) => toTransactionDto(t, page.tagsByTransactionId.get(t.id) ?? [])),
          nextCursor: page.nextCursor,
        },
      };
    });
  }

  @TsRestHandler(transactionsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(transactionsContract.create, async ({ params, body }) => {
      const { transaction, tagIds } = await this.transactions.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toTransactionDto(transaction, tagIds) };
    });
  }

  @TsRestHandler(transactionsContract.get)
  get(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(transactionsContract.get, async ({ params }) => {
      const { transaction, tagIds } = await this.transactions.get(
        requireUser(user).id,
        params.groupId,
        params.transactionId,
      );
      return { status: 200 as const, body: toTransactionDto(transaction, tagIds) };
    });
  }

  @TsRestHandler(transactionsContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(transactionsContract.update, async ({ params, body }) => {
      const { transaction, tagIds } = await this.transactions.update(
        requireUser(user).id,
        params.groupId,
        params.transactionId,
        body,
      );
      return { status: 200 as const, body: toTransactionDto(transaction, tagIds) };
    });
  }

  @TsRestHandler(transactionsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(transactionsContract.remove, async ({ params }) => {
      const { transaction, tagIds } = await this.transactions.remove(
        requireUser(user).id,
        params.groupId,
        params.transactionId,
      );
      return { status: 200 as const, body: toTransactionDto(transaction, tagIds) };
    });
  }
}
