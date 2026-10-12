import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { convertMoney, sumMoney } from '@/lib/money';
import type { Budget, BudgetTotals } from './queries';

export type BudgetSectionKind = 'expense' | 'income' | 'savings' | 'debt';

// What is spent, then what comes in, then what is put aside and paid off.
export const SECTION_ORDER: readonly BudgetSectionKind[] = ['expense', 'income', 'savings', 'debt'];

export type BudgetTarget = { type: 'category'; category: Category } | { type: 'account'; account: Account };

export interface BudgetLineRow {
  line: Budget;
  target: BudgetTarget;
  // All in the line's currency.
  amount: string;
  recorded: string;
  planned: string;
  // What the amount still leaves once the recorded and the planned are counted: above zero there is
  // that much to go, below zero the line is past its amount by that much.
  remaining: string;
}

export interface UnbudgetedRow {
  // The category's id, or '' for what was filed under none.
  key: string;
  category: Category | null;
  // Recorded and planned together, in the main currency.
  total: string;
}

export interface BudgetSection {
  kind: BudgetSectionKind;
  lines: BudgetLineRow[];
  // The lines' amounts and what is recorded against them, in the main currency.
  total: { amount: string; recorded: string } | null;
  // Expense and income only: the categories that had money this month but no line, largest first.
  unbudgeted: { rows: UnbudgetedRow[]; total: string } | null;
}

export interface BudgetView {
  // The sections with anything in them, in SECTION_ORDER.
  sections: BudgetSection[];
  // Currencies no rate converts, whose amounts are left out of the sums they'd have gone into.
  missingCurrencyIds: number[];
}

export interface BudgetViewInput {
  lines: Budget[];
  totals: BudgetTotals;
  // Archived ones included: a line, or last month's money, can belong to one put away since.
  categories: Category[];
  accounts: Account[];
  // The signed-in person's main currency, which the section totals are in; unknown while loading.
  mainCurrencyId: number | undefined;
  // The rate from one currency to another, or null without one. The same currency is '1'.
  rate: (fromCurrencyId: number, toCurrencyId: number) => string | null;
}

/**
 * A month's budget as the page shows it: each line beside what was recorded and planned against
 * it, and per section what the lines add up to and what went where nothing was budgeted.
 *
 * Money is converted into the currency it's compared with — a line's, or the main one for the
 * totals — at the app's rates. A currency without a rate is left out and named, never guessed.
 */
export function buildBudgetView({ lines, totals, categories, accounts, mainCurrencyId, rate }: BudgetViewInput): BudgetView {
  const missing = new Set<number>();
  // amount in `from` valued in `to`, or null (and `from` noted) without a rate.
  const convert = (amount: string, from: number, to: number): string | null => {
    if (from === to) {
      return amount;
    }
    const found = rate(from, to);
    if (found === null) {
      missing.add(from);
      return null;
    }
    return convertMoney(amount, found);
  };
  const sumConverted = (amounts: { amount: string; currencyId: number }[], to: number) =>
    sumMoney(['0', ...amounts.map(({ amount, currencyId }) => convert(amount, currencyId, to) ?? '0')]);

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  // A category's money in each currency it was recorded in, by category id ('' for none) and type.
  const categoryMoney = new Map<string, BudgetTotals['categories']>();
  for (const row of totals.categories) {
    const key = `${row.categoryId ?? ''}|${row.type}`;
    categoryMoney.set(key, [...(categoryMoney.get(key) ?? []), row]);
  }
  const accountMoney = new Map(totals.accounts.map((row) => [row.accountId, row]));

  const rows: { kind: BudgetSectionKind; row: BudgetLineRow }[] = [];
  for (const line of lines) {
    const category = line.categoryId ? categoriesById.get(line.categoryId) : undefined;
    const account = line.accountId ? accountsById.get(line.accountId) : undefined;
    let kind: BudgetSectionKind;
    let target: BudgetTarget;
    let recorded: string;
    let planned: string;
    if (category) {
      const money = categoryMoney.get(`${category.id}|${category.type}`) ?? [];
      kind = category.type;
      target = { type: 'category', category };
      recorded = sumConverted(
        money.map((row) => ({ amount: row.recorded, currencyId: row.currencyId })),
        line.currencyId,
      );
      planned = sumConverted(
        money.map((row) => ({ amount: row.planned, currencyId: row.currencyId })),
        line.currencyId,
      );
    } else if (account && account.type !== 'regular') {
      const money = accountMoney.get(account.id);
      kind = account.type;
      target = { type: 'account', account };
      recorded = convert(money?.recorded ?? '0', account.currencyId, line.currencyId) ?? '0';
      planned = convert(money?.planned ?? '0', account.currencyId, line.currencyId) ?? '0';
    } else {
      // Gone from the lists since (the API deletes a line along with what it's for): nothing to show.
      continue;
    }
    rows.push({
      kind,
      row: {
        line,
        target,
        amount: line.amount,
        recorded,
        planned,
        remaining: sumMoney([line.amount, negate(recorded), negate(planned)]),
      },
    });
  }

  const sections: BudgetSection[] = [];
  for (const kind of SECTION_ORDER) {
    const lineRows = rows
      .filter((entry) => entry.kind === kind)
      .map((entry) => entry.row)
      .sort((a, b) => compareTargets(a.target, b.target));
    const total =
      mainCurrencyId === undefined || lineRows.length === 0
        ? null
        : {
            amount: sumConverted(
              lineRows.map((row) => ({ amount: row.amount, currencyId: row.line.currencyId })),
              mainCurrencyId,
            ),
            recorded: sumConverted(
              lineRows.map((row) => ({ amount: row.recorded, currencyId: row.line.currencyId })),
              mainCurrencyId,
            ),
          };
    const unbudgeted =
      (kind === 'expense' || kind === 'income') && mainCurrencyId !== undefined
        ? unbudgetedRows(kind, lineRows, categoryMoney, categoriesById, (money) => sumConverted(money, mainCurrencyId))
        : null;
    if (lineRows.length > 0 || unbudgeted) {
      sections.push({ kind, lines: lineRows, total, unbudgeted });
    }
  }

  return { sections, missingCurrencyIds: [...missing] };
}

function unbudgetedRows(
  type: 'expense' | 'income',
  lineRows: BudgetLineRow[],
  categoryMoney: Map<string, BudgetTotals['categories']>,
  categoriesById: Map<string, Category>,
  toMain: (money: { amount: string; currencyId: number }[]) => string,
): BudgetSection['unbudgeted'] {
  const budgeted = new Set(lineRows.map((row) => row.line.categoryId));
  const found: UnbudgetedRow[] = [];
  for (const [key, money] of categoryMoney) {
    const [categoryId, moneyType] = key.split('|');
    if (moneyType !== type || budgeted.has(categoryId)) {
      continue;
    }
    const category = categoryId ? categoriesById.get(categoryId) : null;
    if (category === undefined) {
      continue;
    }
    const total = toMain(money.flatMap((row) => [
      { amount: row.recorded, currencyId: row.currencyId },
      { amount: row.planned, currencyId: row.currencyId },
    ]));
    if (/[1-9]/.test(total)) {
      found.push({ key: categoryId, category, total });
    }
  }
  if (found.length === 0) {
    return null;
  }
  found.sort((a, b) => Number(b.total) - Number(a.total));
  return { rows: found, total: sumMoney(found.map((row) => row.total)) };
}

// As the categories page and the account lists order them.
function compareTargets(a: BudgetTarget, b: BudgetTarget): number {
  const entity = (target: BudgetTarget) => (target.type === 'category' ? target.category : target.account);
  return entity(a).sortOrder - entity(b).sortOrder || entity(a).name.localeCompare(entity(b).name);
}

export function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/** The section a line sits in. A regular account never has a line: the API drops one turned regular. */
export function sectionOf(target: BudgetTarget): BudgetSectionKind {
  return target.type === 'category' ? target.category.type : target.account.type === 'debt' ? 'debt' : 'savings';
}

/** The name a line goes by. */
export function targetName(target: BudgetTarget): string {
  return target.type === 'category' ? target.category.name : target.account.name;
}
