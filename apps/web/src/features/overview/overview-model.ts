import { endOfMonth, getDaysInMonth, startOfMonth } from 'date-fns';
import { validColor } from '@/components/appearance/appearance';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { convertMoney, sumMoney } from '@/lib/money';
import type { OverviewDays } from './queries';

export const OVERVIEW_TYPES = ['expense', 'income'] as const;
export type OverviewType = (typeof OVERVIEW_TYPES)[number];

// For what has no color of its own: money filed under no category, or a category or debt without one.
// The app's gray for money that is neither coming in nor going out.
export const NEUTRAL_COLOR = '#95949a';

/** What money went on or came from: a category, a debt account, or nothing it was filed under. */
export type OverviewSource =
  | { kind: 'category'; category: Category }
  | { kind: 'debt'; account: Account }
  | { kind: 'none' };

export interface OverviewRow {
  // 'category:<id>', 'debt:<id>', or 'none'.
  key: string;
  source: OverviewSource;
  // The month's, in the main currency.
  total: string;
  // Of the tab's total, from 0 to 1.
  share: number;
}

export interface OverviewDay {
  // The day of the month, from 1.
  day: number;
  total: string;
  // What it went on, in the order of the tab's rows; nothing that came to zero.
  parts: { key: string; amount: string }[];
}

export interface OverviewTab {
  total: string;
  // Largest first.
  rows: OverviewRow[];
  // Every day of the month, those with nothing included.
  days: OverviewDay[];
  // Over the days of the month that have come, today's included; null while none has.
  perDay: string | null;
  perWeek: string | null;
}

export interface OverviewView {
  expense: OverviewTab;
  income: OverviewTab;
  // Currencies no rate converts, whose amounts are left out of everything.
  missingCurrencyIds: number[];
}

export interface OverviewViewInput {
  days: OverviewDays;
  // The first of the month.
  month: Date;
  now: Date;
  // Archived ones included: money in a month gone by can belong to one put away since.
  categories: Category[];
  accounts: Account[];
  mainCurrencyId: number;
  // The rate from one currency to another, or null without one.
  rate: (fromCurrencyId: number, toCurrencyId: number) => string | null;
}

/**
 * A month's money as the overview shows it, a tab each for what was spent and what was received:
 * per category and debt, per day, and on average. Everything is in the main currency, at the app's
 * rates; a currency without a rate is left out and named, never guessed.
 */
export function buildOverview({ days, month, now, categories, accounts, mainCurrencyId, rate }: OverviewViewInput): OverviewView {
  const missing = new Set<number>();
  const toMain = (amount: string, currencyId: number): string | null => {
    if (currencyId === mainCurrencyId) {
      return amount;
    }
    const found = rate(currencyId, mainCurrencyId);
    if (found === null) {
      missing.add(currencyId);
      return null;
    }
    return convertMoney(amount, found);
  };
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  // Undefined for one gone from the lists since, which the next refetch of them settles.
  const sourceOf = (entry: OverviewDays[number]): { key: string; source: OverviewSource } | undefined => {
    if (entry.accountId) {
      const account = accountsById.get(entry.accountId);
      return account && { key: `debt:${account.id}`, source: { kind: 'debt', account } };
    }
    if (entry.categoryId) {
      const category = categoriesById.get(entry.categoryId);
      return category && { key: `category:${category.id}`, source: { kind: 'category', category } };
    }
    return { key: 'none', source: { kind: 'none' } };
  };
  const daysInMonth = getDaysInMonth(month);
  const counted = daysCounted(month, now);

  const tab = (type: OverviewType): OverviewTab => {
    const sources = new Map<string, OverviewSource>();
    // Each row's amounts, by day of the month.
    const amounts = new Map<string, Map<number, string[]>>();
    for (const entry of days) {
      const found = entry.type === type ? sourceOf(entry) : undefined;
      const amount = found && toMain(entry.amount, entry.currencyId);
      const day = Number(entry.day.slice(8, 10));
      if (!found || amount === undefined || amount === null || day < 1 || day > daysInMonth) {
        continue;
      }
      sources.set(found.key, found.source);
      const byDay = amounts.get(found.key) ?? new Map<number, string[]>();
      byDay.set(day, [...(byDay.get(day) ?? []), amount]);
      amounts.set(found.key, byDay);
    }

    const totals = [...sources].map(([key, source]) => ({
      key,
      source,
      total: sumMoney([...(amounts.get(key)?.values() ?? [])].flat()),
    }));
    totals.sort((a, b) => Number(b.total) - Number(a.total) || nameOf(a.source).localeCompare(nameOf(b.source)));
    const total = sumMoney(['0.00', ...totals.map((row) => row.total)]);
    const rows = totals.map((row) => ({ ...row, share: shareOf(row.total, total) }));

    const dayList: OverviewDay[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const parts = rows
        .map((row) => ({ key: row.key, amount: sumMoney(['0.00', ...(amounts.get(row.key)?.get(day) ?? [])]) }))
        .filter((part) => /[1-9]/.test(part.amount));
      dayList.push({ day, total: sumMoney(['0.00', ...parts.map((part) => part.amount)]), parts });
    }

    return {
      total,
      rows,
      days: dayList,
      perDay: counted > 0 ? average(total, counted, 1) : null,
      perWeek: counted > 0 ? average(total, counted, 7) : null,
    };
  };

  const expense = tab('expense');
  const income = tab('income');
  return { expense, income, missingCurrencyIds: [...missing] };
}

/**
 * The first rows of a tab, and the rest folded into one, with what they add up to. Folding a single
 * row would only hide it behind another, so up to one more than `shown` are all shown.
 */
export function foldRows(
  rows: OverviewRow[],
  shown = 3,
): { shown: OverviewRow[]; more: { rows: OverviewRow[]; total: string; share: number } | null } {
  if (rows.length <= shown + 1) {
    return { shown: rows, more: null };
  }
  const rest = rows.slice(shown);
  return {
    shown: rows.slice(0, shown),
    more: { rows: rest, total: sumMoney(rest.map((row) => row.total)), share: rest.reduce((sum, row) => sum + row.share, 0) },
  };
}

/** The color a source's money is drawn in. */
export function sourceColor(source: OverviewSource): string {
  const color = source.kind === 'category' ? source.category.color : source.kind === 'debt' ? source.account.color : null;
  return validColor(color) ?? NEUTRAL_COLOR;
}

// The name it goes by, or '' for nothing filed (which a page names in its own language).
function nameOf(source: OverviewSource): string {
  return source.kind === 'category' ? source.category.name : source.kind === 'debt' ? source.account.name : '';
}

// How many days of the month have come: all of them for one gone by, none for one still to come.
function daysCounted(month: Date, now: Date): number {
  if (now < startOfMonth(month)) {
    return 0;
  }
  return now > endOfMonth(month) ? getDaysInMonth(month) : now.getDate();
}

// Display only, like the formatting it goes to: the float never feeds back into stored or summed money.
function average(total: string, days: number, per: number): string {
  return ((Number(total) / days) * per).toFixed(2);
}

function shareOf(amount: string, total: string): number {
  const whole = Number(total);
  return whole > 0 ? Number(amount) / whole : 0;
}
