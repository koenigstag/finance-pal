import type { Account, Budget, Category, Transaction } from '@ft/api-database';
import { sumMoney } from '@ft/shared-contracts';
import type { AccountWithBalance } from '../../ledger/accounts/accounts.service';
import type { CurrencyCodes } from '../external-lookup.service';
import { localDateTime } from './mcp-dates';

// How the MCP endpoint's tools put one thing in an answer: names in place of ids, each amount
// beside its currency, dates as the person reads them.

/**
 * A transaction as an assistant reads it, given the group's accounts and categories (archived and
 * deleted ones included, so an old transaction still names its own).
 */
export function transactionDescriber(accounts: Account[], categories: Category[], currencies: CurrencyCodes, timeZone: string, now: Date) {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return (transaction: Transaction) => {
    const toAccount = transaction.toAccountId ? accountsById.get(transaction.toAccountId) : undefined;
    const category = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
    const subcategory = transaction.subcategoryId ? categoriesById.get(transaction.subcategoryId) : undefined;
    // The same column holds a transfer's received amount and, for an expense or an income, the
    // amount in its category's own currency.
    const otherAmount = transaction.destAmount === null ? null : cents(transaction.destAmount);
    return {
      id: transaction.id,
      date: localDateTime(transaction.date, timeZone),
      type: transaction.type,
      amount: cents(transaction.amount),
      currency: currencies.of(transaction.currencyId),
      account: accountsById.get(transaction.accountId)?.name ?? null,
      ...(toAccount && { toAccount: toAccount.name }),
      ...(toAccount && otherAmount !== null && { received: { amount: otherAmount, currency: currencies.of(toAccount.currencyId) } }),
      ...(category && { category: category.name }),
      ...(subcategory && { subcategory: subcategory.name }),
      ...(!toAccount &&
        category?.currencyId != null &&
        otherAmount !== null && { inCategoryCurrency: { amount: otherAmount, currency: currencies.of(category.currencyId) } }),
      ...(transaction.note && { note: transaction.note }),
      ...(transaction.date > now && { planned: true }),
    };
  };
}

// "30000" as the ledger reads it back, "30000.00": a write hands back the amount as it was typed.
function cents(amount: string): string {
  return sumMoney(['0.00', amount]);
}

/** An account as a tool that changed it answers with it. */
export function describeAccount({ account, balance }: AccountWithBalance, currencies: CurrencyCodes) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: currencies.of(account.currencyId),
    balance,
    countedInTotal: account.isIncludedInBalance && !account.archived,
    ...(account.isFavourite && { favourite: true }),
    ...(account.archived && { archived: true }),
    ...(account.description && { description: account.description }),
  };
}

/** A category as a tool that changed it answers with it, its parent named. */
export function describeCategory(category: Category, categories: Category[], currencies: CurrencyCodes) {
  const parent = category.parentId ? categories.find((candidate) => candidate.id === category.parentId) : undefined;
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    ...(parent && { parent: parent.name }),
    ...(category.currencyId !== null && { currency: currencies.of(category.currencyId) }),
    ...(category.archived && { archived: true }),
  };
}

/** A budget line as a tool that changed it answers with it. */
export function describeBudgetLine(line: Budget, name: string, currencies: CurrencyCodes) {
  return {
    id: line.id,
    month: line.month.slice(0, 7),
    for: name,
    budgeted: line.amount,
    currency: currencies.of(line.currencyId),
  };
}
