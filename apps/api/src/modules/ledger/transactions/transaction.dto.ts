import { Transaction } from '@ft/api-database';

// Shared by every endpoint that returns transactions (the transactions API itself and the
// recurring rules' upcoming occurrences), so both always satisfy the same contract schema.
export function toTransactionDto(transaction: Transaction, tagIds: string[]) {
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
