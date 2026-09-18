import type { Category, Transaction } from '@ft/api-database';
import type { AccountWithBalance } from '../ledger/accounts/accounts.service';
import type { CurrencyCodes } from './external-lookup.service';

// The external API's own shapes, not the web app's DTOs: its contract is versioned apart, and it
// names currencies by code where the app uses internal ids.

export function toExternalAccount({ account, balance }: AccountWithBalance, currencies: CurrencyCodes) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: currencies.of(account.currencyId),
    balance,
    plannedBalance: account.cachedBalance,
    isFavourite: account.isFavourite,
    isIncludedInBalance: account.isIncludedInBalance,
    archived: account.archived,
    description: account.description,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function toExternalCategory(category: Category) {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    parentId: category.parentId,
    archived: category.archived,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function toExternalTransaction(transaction: Transaction, currencies: CurrencyCodes) {
  return {
    id: transaction.id,
    type: transaction.type,
    date: transaction.date.toISOString(),
    amount: transaction.amount,
    currency: currencies.of(transaction.currencyId),
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    subcategoryId: transaction.subcategoryId,
    toAccountId: transaction.toAccountId,
    destAmount: transaction.destAmount,
    note: transaction.note,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
