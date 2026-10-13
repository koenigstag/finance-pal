import type { Account, Budget, Category, RecurringRule, Transaction } from '@ft/api-database';
import { sumMoney } from '@ft/shared-contracts';
import type { AccountWithBalance } from '../../ledger/accounts/accounts.service';
import type { RecurringRuleView } from '../../recurring/recurring-rules.service';
import type { CurrencyCodes } from '../external-lookup.service';
import { localDateTime } from './mcp-dates';

// How the MCP endpoint's tools put one thing in an answer: names in place of ids, each amount
// beside its currency, dates as the person reads them.

/** What a transaction is described against: the group's accounts, categories and series. */
export interface DescribeContext {
  // Archived ones included, so an old transaction still names its own.
  accounts: Account[];
  categories: Category[];
  series: RecurringRule[];
  currencies: CurrencyCodes;
  timeZone: string;
  now: Date;
}

/**
 * A transaction as an assistant reads it. Besides what it is, it says how its amount was worked out
 * when the app works it out — a percentage, or rounding the balance — and when that amount still
 * follows its account's balance: such a planned amount changes on its own whenever the balance
 * does, until its date, and an assistant that can't see why takes it for a mistake.
 */
export function transactionDescriber({ accounts, categories, series, currencies, timeZone, now }: DescribeContext) {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const seriesById = new Map(series.map((rule) => [rule.id, rule]));
  return (transaction: Transaction) => {
    const rule = transaction.recurringRuleId ? seriesById.get(transaction.recurringRuleId) : undefined;
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
      ...amountSourceOf(transaction, currencies),
      ...(rule && {
        series: {
          id: rule.id,
          every: rule.intervalValue,
          unit: rule.intervalUnit,
          ...(rule.endsOn !== null && { endsOn: rule.endsOn }),
          ...(!rule.active && { paused: true }),
        },
        // Edited on its own: changing the series no longer changes this one.
        ...(transaction.isCustomized && { editedApartFromSeries: true }),
      }),
    };
  };
}

/**
 * How the app works a transaction's amount out, when it does: as a percentage of a fixed amount or
 * of the account's balance, or as whatever leaves the balance on a round multiple. An amount from
 * the balance worked out before its date is an estimate, recalculated each time the balance
 * changes until the date comes, when it's worked out a last time.
 */
export function amountSourceOf(transaction: Transaction, currencies: CurrencyCodes) {
  const followsBalance =
    transaction.percentageAsOf !== null && transaction.percentageAsOf.getTime() < transaction.date.getTime();
  const flag = followsBalance ? { followsBalance: true as const } : {};
  if (transaction.percentage !== null) {
    return {
      amountFrom: {
        percentage: plainNumber(transaction.percentage),
        of:
          transaction.percentageBase === null
            ? ('balance' as const)
            : { amount: cents(transaction.percentageBase), currency: currencies.of(transaction.currencyId) },
        ...flag,
      },
    };
  }
  if (transaction.roundBalanceTo !== null) {
    return { amountFrom: { roundsBalanceTo: transaction.roundBalanceTo, ...flag } };
  }
  return {};
}

/**
 * A repeating series as an assistant reads it: what each payment is and how it's worked out, how
 * often it comes, its next payment, and its end. ended is one past its last day, which has no next
 * payment and makes none; paused, one on hold until resumed.
 */
export function describeSeries(
  { rule, nextOccurrence }: RecurringRuleView,
  { accounts, categories, currencies, timeZone }: Pick<DescribeContext, 'accounts' | 'categories' | 'currencies' | 'timeZone'>,
) {
  const accountName = (id: string | null) => accounts.find((account) => account.id === id)?.name;
  const categoryName = (id: string | null) => categories.find((category) => category.id === id)?.name;
  const toAccount = accountName(rule.toAccountId);
  const category = categoryName(rule.categoryId);
  const subcategory = categoryName(rule.subcategoryId);
  return {
    id: rule.id,
    type: rule.type,
    amount: cents(rule.amount),
    currency: currencies.of(rule.currencyId),
    account: accountName(rule.accountId) ?? null,
    ...(toAccount && { toAccount }),
    ...(category && { category }),
    ...(subcategory && { subcategory }),
    ...(rule.note && { note: rule.note }),
    ...seriesAmountSource(rule, currencies),
    every: rule.intervalValue,
    unit: rule.intervalUnit,
    firstPayment: localDateTime(rule.startsAt, timeZone),
    nextPayment: nextOccurrence ? localDateTime(nextOccurrence, timeZone) : null,
    ...(rule.endsOn !== null && { endsOn: rule.endsOn }),
    ...(!rule.active && { paused: true }),
    ...(rule.active && nextOccurrence === null && { ended: true }),
  };
}

// How a series works out each payment: as on a transaction, worked out afresh on each payment's date.
function seriesAmountSource(rule: RecurringRuleView['rule'], currencies: CurrencyCodes) {
  if (rule.percentage !== null) {
    return {
      amountFrom: {
        percentage: plainNumber(rule.percentage),
        of: rule.percentageBase === null ? ('balance' as const) : { amount: cents(rule.percentageBase), currency: currencies.of(rule.currencyId) },
      },
    };
  }
  return rule.roundBalanceTo !== null ? { amountFrom: { roundsBalanceTo: rule.roundBalanceTo } } : {};
}

// numeric(7,4) reads back padded: "3.5000" is 3.5.
function plainNumber(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
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
