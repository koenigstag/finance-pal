import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { convertMoney, moneySign, sumMoney } from '@/lib/money';
import type { Budget, BudgetTotals } from './queries';

export type BudgetSectionKind = 'expense' | 'income' | 'savings' | 'debt';

// What is spent, then what is put aside and paid off, and last what comes in. The picker's tabs
// follow the same order.
export const SECTION_ORDER: readonly BudgetSectionKind[] = ['expense', 'savings', 'debt', 'income'];

export type BudgetTarget = { type: 'category'; category: Category } | { type: 'account'; account: Account };

export interface BudgetLineRow {
  line: Budget;
  target: BudgetTarget;
  // A debt line for a loan someone owes back: money coming in, so what is recorded and planned
  // against it is what came out of the account, and it adds to what is available.
  incoming: boolean;
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
  // What the income lines and the loans coming back leave once the expense, savings and other debt
  // lines are taken out, in the main currency: below zero the month means to give out more than it
  // brings in. Null without lines.
  available: string | null;
  // The month under way only, in the main currency, over the accounts the total balance counts.
  balance: MonthBalance | null;
  // Currencies no rate converts, whose amounts are left out of the sums they'd have gone into.
  missingCurrencyIds: number[];
}

export interface MonthBalance {
  // What they held as the month began: today's balances less what was recorded on them since.
  start: string;
  // What they'll hold once it ends, should the rest of it go to plan: today's balances, what is
  // already planned on them this month, and what the lines still leave to spend or receive.
  forecast: string;
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
  // Whether this is the month under way: only it can start from today's balances.
  current?: boolean;
}

/**
 * A month's budget as the page shows it: each line beside what was recorded and planned against
 * it, and per section what the lines add up to and what went where nothing was budgeted.
 *
 * Money is converted into the currency it's compared with — a line's, or the main one for the
 * totals — at the app's rates. A currency without a rate is left out and named, never guessed.
 */
export function buildBudgetView({
  lines,
  totals,
  categories,
  accounts,
  mainCurrencyId,
  rate,
  current = false,
}: BudgetViewInput): BudgetView {
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
    let incoming = false;
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
      // Somebody owes the user, as the account's actions read it, so the line is for getting it
      // back. Settled since, the month's own money tells: it came out of the account.
      const balance = moneySign(account.balance);
      incoming =
        account.type === 'debt' &&
        (balance > 0 || (balance === 0 && moneySign(sumMoney([money?.recorded ?? '0', money?.planned ?? '0'])) < 0));
      if (incoming) {
        recorded = negate(recorded);
        planned = negate(planned);
      }
    } else {
      // Gone from the lists since (the API deletes a line along with what it's for): nothing to show.
      continue;
    }
    rows.push({
      kind,
      row: {
        line,
        target,
        incoming,
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

  // Everything else is money the month gives out: spent, put aside, paid off or lent.
  const available =
    mainCurrencyId === undefined || rows.length === 0
      ? null
      : sumMoney([
          '0',
          ...rows.map(({ kind, row }) => {
            const amount = convert(row.amount, row.line.currencyId, mainCurrencyId) ?? '0';
            return kind === 'income' || row.incoming ? amount : negate(amount);
          }),
        ]);

  let monthBalance: MonthBalance | null = null;
  if (current && mainCurrencyId !== undefined) {
    const toMain = (amount: string, currencyId: number) => convert(amount, currencyId, mainCurrencyId) ?? '0';
    // As the total balance counts them: archived ones never, whatever their own flag still says.
    const counted = accounts.filter((account) => account.isIncludedInBalance && !account.archived);
    const countedIds = new Set(counted.map((account) => account.id));
    const start = sumMoney([
      '0',
      ...counted.map((account) =>
        toMain(sumMoney([account.balance, negate(accountMoney.get(account.id)?.recorded ?? '0')]), account.currencyId),
      ),
    ]);
    const scheduled = sumMoney([
      '0',
      ...counted.map((account) => toMain(sumMoney([account.balance, accountMoney.get(account.id)?.planned ?? '0']), account.currencyId)),
    ]);
    // What a line still leaves once its recorded and planned money is counted; a line past its
    // amount leaves nothing more. Spending is taken to come out of the counted accounts and income
    // to go into them, so money put aside or paid off only leaves the total for an account outside it.
    const toCome = rows.map(({ kind, row }) => {
      if (moneySign(row.remaining) <= 0) {
        return '0';
      }
      const amount = toMain(row.remaining, row.line.currencyId);
      if (kind === 'income') {
        return amount;
      }
      if (kind === 'expense') {
        return negate(amount);
      }
      if (row.target.type === 'account' && countedIds.has(row.target.account.id)) {
        return '0';
      }
      return row.incoming ? amount : negate(amount);
    });
    monthBalance = { start, forecast: sumMoney([scheduled, ...toCome]) };
  }

  return { sections, available, balance: monthBalance, missingCurrencyIds: [...missing] };
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
  // Zero stays as it is: "-0" would show as a minus.
  return moneySign(amount) === 0 ? amount : amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/** The section a line sits in. A regular account never has a line: the API drops one turned regular. */
export function sectionOf(target: BudgetTarget): BudgetSectionKind {
  return target.type === 'category' ? target.category.type : target.account.type === 'debt' ? 'debt' : 'savings';
}

/** The name a line goes by. */
export function targetName(target: BudgetTarget): string {
  return target.type === 'category' ? target.category.name : target.account.name;
}
