import { Transaction } from '@ft/api-database';
import { isRoundBalanceStep, type RoundBalanceStep } from '@ft/shared-contracts';

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
    subcategoryId: transaction.subcategoryId,
    toAccountId: transaction.toAccountId,
    destAmount: transaction.destAmount,
    percentage: transaction.percentage === null ? null : withoutTrailingZeros(transaction.percentage),
    percentageBase: transaction.percentageBase,
    roundBalanceTo: roundBalanceStepOf(transaction.roundBalanceTo),
    percentageAsOf: transaction.percentageAsOf?.toISOString() ?? null,
    destAmountAsOf: transaction.destAmountAsOf?.toISOString() ?? null,
    note: transaction.note,
    tagIds,
    recurringRuleId: transaction.recurringRuleId,
    recurrenceDate: transaction.recurrenceDate?.toISOString() ?? null,
    isCustomized: transaction.isCustomized,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

// numeric(7,4) comes back padded ("3.5000"); the figure as typed ("3.5") is what the client shows.
export function withoutTrailingZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/\.?0+$/, '') : decimal;
}

// A smallint to the database, one of four steps to the contract; its check allows no other.
export function roundBalanceStepOf(value: number | null): RoundBalanceStep | null {
  return value !== null && isRoundBalanceStep(value) ? value : null;
}
