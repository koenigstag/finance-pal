import { format } from 'date-fns';
import { ArrowRightIcon, RepeatIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Badge } from '@/components/ui/badge';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Transaction } from './queries';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  // Absent for callers who can't edit: rows then render as plain, non-interactive items.
  onSelect?: (transaction: Transaction) => void;
}

/** Transactions grouped under a heading per local calendar day, newest first as the API sorts them. */
export function TransactionList({ transactions, accounts, categories, onSelect }: TransactionListProps) {
  const { i18n } = useTranslation();
  const days = useMemo(() => groupByDay(transactions), [transactions]);
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
    [i18n.language],
  );
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // Rendered once per list, not per row: rows compare against the same instant.
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      {days.map(({ day, items }) => (
        <section key={day} className="flex flex-col gap-1">
          <h3 className="px-1 text-sm font-medium text-muted-foreground">{dayFormat.format(items[0].dateValue)}</h3>
          <ul className="divide-y rounded-xl border">
            {items.map(({ transaction, dateValue }) => (
              <li key={transaction.id}>
                <TransactionRow
                  transaction={transaction}
                  planned={dateValue.getTime() > now}
                  accountsById={accountsById}
                  categoriesById={categoriesById}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface TransactionRowProps {
  transaction: Transaction;
  planned: boolean;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  onSelect?: (transaction: Transaction) => void;
}

function TransactionRow({ transaction, planned, accountsById, categoriesById, onSelect }: TransactionRowProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const account = accountsById.get(transaction.accountId);
  const toAccount = transaction.toAccountId ? accountsById.get(transaction.toAccountId) : undefined;
  const isTransfer = transaction.type === 'transfer';

  const category = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
  const title = isTransfer ? t('transactions.types.transfer') : (category?.name ?? t('transactions.noCategory'));
  const sign = transaction.type === 'expense' ? '−' : transaction.type === 'income' ? '+' : '';
  const amount = formatMoney(transaction.amount, currencyCodes.get(transaction.currencyId), i18n.language);
  const destAmount =
    isTransfer && transaction.destAmount && toAccount
      ? formatMoney(transaction.destAmount, currencyCodes.get(toAccount.currencyId), i18n.language)
      : null;

  const content = (
    <>
      <AppearanceIcon
        icon={category?.icon}
        color={category?.color}
        placeholder={isTransfer ? 'transfer' : category ? undefined : 'none'}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">
          {title}
          {transaction.recurringRuleId && (
            <RepeatIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('transactions.recurring')} />
          )}
        </p>
        <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
          {account?.name ?? '—'}
          {isTransfer && (
            <>
              <ArrowRightIcon className="size-3.5 shrink-0" />
              {toAccount?.name ?? '—'}
            </>
          )}
          {transaction.note && <span className="truncate"> · {transaction.note}</span>}
        </p>
        {(planned || transaction.isCustomized) && (
          <div className="mt-1 flex gap-1">
            {planned && <Badge variant="outline">{t('transactions.planned')}</Badge>}
            {transaction.isCustomized && <Badge variant="secondary">{t('transactions.customized')}</Badge>}
          </div>
        )}
      </div>
      <div className="text-right">
        <p
          className={cn(
            'font-medium whitespace-nowrap tabular-nums',
            transaction.type === 'income' && 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {sign}
          {amount}
        </p>
        {destAmount && <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">→ {destAmount}</p>}
      </div>
    </>
  );

  const className = cn('flex w-full items-start gap-3 px-4 py-3 text-left', planned && 'text-muted-foreground');
  return onSelect ? (
    <button type="button" className={cn(className, 'hover:bg-muted/50')} onClick={() => onSelect(transaction)}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function groupByDay(transactions: Transaction[]) {
  const days: { day: string; items: { transaction: Transaction; dateValue: Date }[] }[] = [];
  for (const transaction of transactions) {
    const dateValue = new Date(transaction.date);
    const day = format(dateValue, 'yyyy-MM-dd');
    const last = days.at(-1);
    if (last?.day === day) {
      last.items.push({ transaction, dateValue });
    } else {
      days.push({ day, items: [{ transaction, dateValue }] });
    }
  }
  return days;
}
