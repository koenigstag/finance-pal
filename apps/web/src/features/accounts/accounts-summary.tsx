import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { useProfile } from '@/features/profile/queries';
import { convertMoney, formatMoney, moneySign, sumMoney } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import type { Account } from './queries';

// After the main currency, the ones most likely to be held; anything else follows by code.
const CURRENCY_ORDER = ['USD', 'EUR'];

// Currencies are added together only through the rates the user keeps by hand (settings); without
// one for every currency on show, the converted row is left out rather than guessed at.
interface CurrencyRow {
  currencyId: number;
  code: string | undefined;
  regular: string;
  savings: string;
  owed: string;
  lent: string;
  assets: string;
  debts: string;
}

/**
 * What the group holds, in two small tables: by kind of account, then as assets against debts.
 * Both count every account, archived ones aside, including those the running total in the header
 * leaves out.
 */
export function AccountsSummary({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation();
  const profile = useProfile();
  const currencyCodes = useCurrencyCodes();
  const baseCode = currencyCodes.get(profile.data?.mainCurrencyId ?? -1);

  const rows = useMemo(() => {
    const byCurrency = new Map<number, Account[]>();
    for (const account of accounts) {
      byCurrency.set(account.currencyId, [...(byCurrency.get(account.currencyId) ?? []), account]);
    }
    const sumOf = (list: Account[]) => sumMoney(list.map((account) => account.balance));
    const ofType = (list: Account[], type: Account['type']) => list.filter((account) => account.type === type);

    return [...byCurrency]
      .map(([currencyId, list]): CurrencyRow => {
        const debtAccounts = ofType(list, 'debt');
        return {
          currencyId,
          code: currencyCodes.get(currencyId),
          regular: sumOf(ofType(list, 'regular')),
          savings: sumOf(ofType(list, 'savings')),
          // A debt account swings both ways: what someone owes you is positive, what you owe them
          // is negative. Splitting by sign keeps "I owe" and "owed to me" from cancelling out.
          owed: sumOf(debtAccounts.filter((account) => moneySign(account.balance) < 0)),
          lent: sumOf(debtAccounts.filter((account) => moneySign(account.balance) > 0)),
          assets: sumOf(list.filter((account) => moneySign(account.balance) > 0)),
          debts: sumOf(list.filter((account) => moneySign(account.balance) < 0)),
        };
      })
      // The main currency first, then the usual suspects, then the rest by code.
      .sort((a, b) => rank(a, profile.data?.mainCurrencyId) - rank(b, profile.data?.mainCurrencyId) || (a.code ?? '').localeCompare(b.code ?? ''));
  }, [accounts, currencyCodes, profile.data?.mainCurrencyId]);

  // In the base currency: each column added up across the currencies, and the two against each
  // other. Missing a rate for any currency on show, there is no honest total to give.
  const rates = profile.data?.exchangeRates ?? {};
  const rateFor = (row: CurrencyRow) =>
    row.currencyId === profile.data?.mainCurrencyId ? '1' : row.code ? rates[row.code] : undefined;
  const converted = rows.every((row) => rateFor(row))
    ? {
        assets: sumMoney(rows.map((row) => convertMoney(row.assets, rateFor(row) ?? '1'))),
        debts: sumMoney(rows.map((row) => convertMoney(row.debts, rateFor(row) ?? '1'))),
      }
    : null;
  const total = converted && sumMoney([converted.assets, converted.debts]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <SummaryTable
        caption={t('accounts.summary.byType')}
        columns={[
          { key: 'regular', label: t('accounts.groups.regular') },
          { key: 'savings', label: t('accounts.groups.savings') },
          { key: 'owed', label: t('accounts.summary.owed') },
          { key: 'lent', label: t('accounts.summary.lent') },
        ]}
        rows={rows}
      />
      <SummaryTable
        caption={t('accounts.summary.byKind')}
        columns={[
          { key: 'assets', label: t('accounts.summary.assets') },
          { key: 'debts', label: t('accounts.summary.debts') },
        ]}
        rows={rows}
        footer={
          converted && total !== null ? (
            <>
              <tr className="border-t-2">
                <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  = {baseCode}
                </th>
                {(['assets', 'debts'] as const).map((key) => (
                  <Amount key={key} amount={converted[key]} code={baseCode} />
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  {t('accounts.summary.total')}
                </th>
                <Amount amount={total} code={baseCode} colSpan={2} />
              </tr>
            </>
          ) : (
            <tr className="border-t">
              <td colSpan={3} className="px-3 py-2 text-sm text-muted-foreground">
                {t('accounts.summary.ratesMissing')}
              </td>
            </tr>
          )
        }
      />
    </div>
  );
}

interface Column {
  key: keyof Pick<CurrencyRow, 'regular' | 'savings' | 'owed' | 'lent' | 'assets' | 'debts'>;
  label: string;
}

interface SummaryTableProps {
  caption: string;
  columns: Column[];
  rows: CurrencyRow[];
  // Totals across the currencies above, when there are rates to reach them by.
  footer?: ReactNode;
}

function SummaryTable({ caption, columns, rows, footer }: SummaryTableProps) {

  return (
    // Narrow screens scroll the table sideways rather than squeezing the amounts.
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {/* The currency of each row is the row's own heading. */}
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.currencyId}>
              <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {row.code ?? row.currencyId}
              </th>
              {columns.map((column) => (
                <Amount key={column.key} amount={row[column.key]} code={row.code} />
              ))}
            </tr>
          ))}
          {footer}
        </tbody>
      </table>
    </div>
  );
}

function Amount({ amount, code, colSpan }: { amount: string; code: string | undefined; colSpan?: number }) {
  const { i18n } = useTranslation();

  return (
    <td
      colSpan={colSpan}
      className={cn('px-3 py-2 text-right whitespace-nowrap tabular-nums', signColor(moneySign(amount)))}
    >
      {formatMoney(amount, code, i18n.language, { currencyDisplay: 'narrowSymbol' })}
    </td>
  );
}

// The main currency leads, then the ones most often held beside it, then everything else.
function rank(row: CurrencyRow, mainCurrencyId: number | undefined): number {
  if (row.currencyId === mainCurrencyId) {
    return -1;
  }
  const index = row.code ? CURRENCY_ORDER.indexOf(row.code) : -1;
  return index === -1 ? CURRENCY_ORDER.length : index;
}
