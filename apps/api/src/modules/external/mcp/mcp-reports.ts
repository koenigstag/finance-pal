import type { Account, Budget, Category } from '@ft/api-database';
import { conversionBetween, convertMoney, sumMoney, type Rate } from '@ft/shared-contracts';
import type { AccountWithBalance } from '../../ledger/accounts/accounts.service';
import type { BudgetTotals } from '../../ledger/budgets/budgets.service';
import type { OverviewDayTotal } from '../../ledger/overview/overview-days';

// What the MCP endpoint's tools answer with, worked out from what the ledger's services return. The
// rules are the web app's own — its accounts total, its overview and its budget page — so an
// assistant asked about the month says what the app shows; the shapes are for reading, with names
// in place of ids and every amount beside its currency.

/** Converts between currencies by id at the app's rates, noting each currency it has no rate for. */
export class Converter {
  private readonly missing = new Set<string>();

  constructor(
    private readonly codeOf: (currencyId: number) => string,
    // Against the main currency, as effectiveRates gives them.
    private readonly rates: Record<string, Rate>,
  ) {}

  /** `amount` in `from`, valued in `to`; null without a rate for the pair, never a guess. */
  convert(amount: string, from: number, to: number): string | null {
    if (from === to) {
      return amount;
    }
    const fromCode = this.codeOf(from);
    const toCode = this.codeOf(to);
    const conversion = conversionBetween(this.rates, fromCode, toCode);
    if (!conversion) {
      this.missing.add(this.rates[fromCode] ? toCode : fromCode);
      return null;
    }
    return convertMoney(amount, conversion.rate);
  }

  /** The sum in `to` of what converts; what doesn't is left out, and its currency noted. */
  sum(amounts: { amount: string; currencyId: number }[], to: number): string {
    return sumMoney(['0.00', ...amounts.map(({ amount, currencyId }) => this.convert(amount, currencyId, to) ?? '0')]);
  }

  /** Currencies left out of a sum for want of a rate, so far. */
  get missingCurrencies(): string[] {
    return [...this.missing].sort();
  }
}

export interface ReportContext {
  codeOf: (currencyId: number) => string;
  mainCurrencyId: number;
  converter: Converter;
}

/**
 * The group's accounts and, as the app's header shows it, the total of those counted in it: in use
 * and marked to count, each converted into the main currency.
 */
export function accountsReport(accounts: AccountWithBalance[], { codeOf, mainCurrencyId, converter }: ReportContext) {
  const counted = accounts.filter(({ account }) => account.isIncludedInBalance && !account.archived);
  return {
    total: {
      amount: converter.sum(
        counted.map(({ account, balance }) => ({ amount: balance, currencyId: account.currencyId })),
        mainCurrencyId,
      ),
      currency: codeOf(mainCurrencyId),
    },
    accounts: accounts.map(({ account, balance }) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: codeOf(account.currencyId),
      balance,
      // With what is planned (dated later) counted in, where that differs.
      ...(account.cachedBalance !== balance && { plannedBalance: account.cachedBalance }),
      ...(account.currencyId !== mainCurrencyId && {
        balanceInMainCurrency: converter.convert(balance, account.currencyId, mainCurrencyId),
      }),
      countedInTotal: account.isIncludedInBalance && !account.archived,
      ...(account.isFavourite && { favourite: true }),
      ...(account.archived && { archived: true }),
      ...(account.description && { description: account.description }),
    })),
    currenciesWithoutRate: converter.missingCurrencies,
  };
}

/** Categories as the app lists them: top-level ones, each with its subcategories. */
export function categoryTree(categories: Category[]) {
  const byOrder = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const children = (parentId: string) =>
    categories
      .filter((category) => category.parentId === parentId)
      .sort(byOrder)
      .map((category) => ({ id: category.id, name: category.name, ...(category.archived && { archived: true }) }));
  return categories
    .filter((category) => category.parentId === null)
    .sort(byOrder)
    .map((category) => {
      const subcategories = children(category.id);
      return {
        id: category.id,
        name: category.name,
        type: category.type,
        ...(category.archived && { archived: true }),
        ...(subcategories.length > 0 && { subcategories }),
      };
    });
}

export type MoneyType = 'expense' | 'income';

/**
 * What was spent or received, by top-level category and by debt account, in the main currency, as
 * the overview's tabs have it: largest first, with each one's share of the total, and averages over
 * the days that have come.
 */
export function moneyByCategory(
  days: OverviewDayTotal[],
  type: MoneyType,
  { categories, accounts, daysSoFar, withDays }: { categories: Category[]; accounts: Account[]; daysSoFar: number; withDays: boolean },
  { mainCurrencyId, converter }: ReportContext,
) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const rows = new Map<string, { name: string; kind: 'category' | 'debt' | 'uncategorized'; id?: string; amounts: string[] }>();
  const byDay = new Map<string, string[]>();

  for (const entry of days) {
    if (entry.type !== type) {
      continue;
    }
    const amount = converter.convert(entry.amount, entry.currencyId, mainCurrencyId);
    if (amount === null) {
      continue;
    }
    const debt = entry.accountId ? accountsById.get(entry.accountId) : undefined;
    const category = entry.categoryId ? categoriesById.get(entry.categoryId) : undefined;
    const source = debt ?? category;
    const kind = debt ? 'debt' : category ? 'category' : 'uncategorized';
    const key = source ? `${kind}:${source.id}` : kind;
    const row = rows.get(key) ?? { name: source?.name ?? 'No category', kind, ...(source && { id: source.id }), amounts: [] };
    row.amounts.push(amount);
    rows.set(key, row);
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), amount]);
  }

  const totals = [...rows.values()].map(({ amounts, ...row }) => ({ ...row, amount: sumMoney(amounts) }));
  totals.sort((a, b) => Number(b.amount) - Number(a.amount) || a.name.localeCompare(b.name));
  const total = sumMoney(['0.00', ...totals.map((row) => row.amount)]);
  return {
    total,
    // Display only, as in the app: the float never feeds back into summed money.
    perDay: daysSoFar > 0 ? (Number(total) / daysSoFar).toFixed(2) : null,
    perWeek: daysSoFar > 0 ? ((Number(total) / daysSoFar) * 7).toFixed(2) : null,
    rows: totals.map((row) => ({ ...row, share: shareOf(row.amount, total) })),
    ...(withDays && {
      days: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, amounts]) => ({ day, amount: sumMoney(amounts) })),
    }),
  };
}

type BudgetSection = 'expense' | 'savings' | 'debt' | 'income';
const SECTION_ORDER: readonly BudgetSection[] = ['expense', 'savings', 'debt', 'income'];

/**
 * A month's budget as the budget page shows it: each line beside what was recorded and planned
 * against it, in the line's currency; per section, what the lines add up to in the main currency,
 * and for expenses and income, where money went that nothing was budgeted for.
 */
export function budgetReport(
  lines: Budget[],
  totals: BudgetTotals,
  { categories, accounts }: { categories: Category[]; accounts: Account[] },
  { codeOf, mainCurrencyId, converter }: ReportContext,
) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const categoryMoney = new Map<string, BudgetTotals['categories']>();
  for (const row of totals.categories) {
    const key = `${row.categoryId ?? ''}|${row.type}`;
    categoryMoney.set(key, [...(categoryMoney.get(key) ?? []), row]);
  }
  const accountMoney = new Map(totals.accounts.map((row) => [row.accountId, row]));

  const rows: { section: BudgetSection; sortOrder: number; line: Budget; row: ReturnType<typeof lineRow> }[] = [];
  for (const line of lines) {
    const category = line.categoryId ? categoriesById.get(line.categoryId) : undefined;
    const account = line.accountId ? accountsById.get(line.accountId) : undefined;
    if (category) {
      const money = categoryMoney.get(`${category.id}|${category.type}`) ?? [];
      const recorded = converter.sum(money.map((row) => ({ amount: row.recorded, currencyId: row.currencyId })), line.currencyId);
      const planned = converter.sum(money.map((row) => ({ amount: row.planned, currencyId: row.currencyId })), line.currencyId);
      rows.push({ section: category.type, sortOrder: category.sortOrder, line, row: lineRow(category.name, line, recorded, planned, codeOf) });
    } else if (account && account.type !== 'regular') {
      const money = accountMoney.get(account.id);
      const recorded = converter.convert(money?.recorded ?? '0', account.currencyId, line.currencyId) ?? '0';
      const planned = converter.convert(money?.planned ?? '0', account.currencyId, line.currencyId) ?? '0';
      rows.push({ section: account.type, sortOrder: account.sortOrder, line, row: lineRow(account.name, line, recorded, planned, codeOf) });
    }
    // Otherwise what the line was for is gone (its line goes with it): nothing to report.
  }

  const sections = SECTION_ORDER.flatMap((section) => {
    const inSection = rows.filter((entry) => entry.section === section).sort((a, b) => a.sortOrder - b.sortOrder);
    const notInBudget =
      section === 'expense' || section === 'income'
        ? unbudgeted(section, new Set(inSection.map((entry) => entry.line.categoryId)), categoryMoney, categoriesById, (money) =>
            converter.sum(money, mainCurrencyId),
          )
        : null;
    if (inSection.length === 0 && !notInBudget) {
      return [];
    }
    return [
      {
        section,
        lines: inSection.map((entry) => entry.row),
        ...(inSection.length > 0 && {
          total: {
            budgeted: converter.sum(inSection.map(({ line }) => ({ amount: line.amount, currencyId: line.currencyId })), mainCurrencyId),
            recorded: converter.sum(
              inSection.map(({ line, row }) => ({ amount: row.recorded, currencyId: line.currencyId })),
              mainCurrencyId,
            ),
            currency: codeOf(mainCurrencyId),
          },
        }),
        ...(notInBudget && { notInBudget }),
      },
    ];
  });
  return { sections, currenciesWithoutRate: converter.missingCurrencies };
}

function lineRow(name: string, line: Budget, recordedAmount: string, plannedAmount: string, codeOf: (currencyId: number) => string) {
  // To the cent, as every other figure reads: an account nothing moved on totals a bare "0".
  const recorded = sumMoney(['0.00', recordedAmount]);
  const planned = sumMoney(['0.00', plannedAmount]);
  return {
    name,
    budgeted: line.amount,
    recorded,
    planned,
    // Above zero, that much is left once the planned money is counted; below zero, the line is past
    // its amount by that much.
    remaining: sumMoney([line.amount, negate(recorded), negate(planned)]),
    currency: codeOf(line.currencyId),
    usedOfBudget: shareOf(recorded, line.amount),
  };
}

// The categories that had money in the month but no line, largest first, in the main currency.
function unbudgeted(
  type: MoneyType,
  budgeted: Set<string | null>,
  categoryMoney: Map<string, BudgetTotals['categories']>,
  categoriesById: Map<string, Category>,
  toMain: (money: { amount: string; currencyId: number }[]) => string,
) {
  const found: { name: string; amount: string }[] = [];
  for (const [key, money] of categoryMoney) {
    const [categoryId, moneyType] = key.split('|');
    if (moneyType !== type || budgeted.has(categoryId)) {
      continue;
    }
    const category = categoryId ? categoriesById.get(categoryId) : null;
    if (category === undefined) {
      continue;
    }
    const amount = toMain(
      money.flatMap((row) => [
        { amount: row.recorded, currencyId: row.currencyId },
        { amount: row.planned, currencyId: row.currencyId },
      ]),
    );
    if (/[1-9]/.test(amount)) {
      found.push({ name: category?.name ?? 'No category', amount });
    }
  }
  if (found.length === 0) {
    return null;
  }
  found.sort((a, b) => Number(b.amount) - Number(a.amount));
  return { total: sumMoney(found.map((row) => row.amount)), rows: found };
}

function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

// A part of a whole as a percentage with one decimal, "23.4%"; null when there's no whole to take it of.
function shareOf(part: string, whole: string): string | null {
  const total = Number(whole);
  return total > 0 ? `${((Number(part) / total) * 100).toFixed(1)}%` : null;
}
