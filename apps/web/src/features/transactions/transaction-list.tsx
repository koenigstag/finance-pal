import { format } from 'date-fns';
import { ArrowRightIcon, ChevronUpIcon, RepeatIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Badge } from '@/components/ui/badge';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { transactionTypeColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import type { Transaction } from './queries';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  // Absent for callers who can't edit: rows then render as plain, non-interactive items.
  onSelect?: (transaction: Transaction) => void;
}

/**
 * Transactions grouped under a heading per local calendar day, newest first as the API sorts them.
 * Planned (future-dated) ones come first, dimmed, then a separator counting them, then everything
 * that already happened. A day with both appears on each side of the separator.
 */
export function TransactionList({ transactions, accounts, categories, onSelect }: TransactionListProps) {
  const { t, i18n } = useTranslation();
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
    [i18n.language],
  );
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // Rendered once per list, not per row: every row compares against the same instant.
  const now = Date.now();
  const planned = transactions.filter((transaction) => new Date(transaction.date).getTime() > now);
  const happened = transactions.filter((transaction) => new Date(transaction.date).getTime() <= now);

  const renderDays = (items: Transaction[], isPlanned: boolean) =>
    groupByDay(items).map(({ day, items: dayItems }) => (
      <section key={`${isPlanned ? 'planned' : 'happened'}-${day}`} className="flex flex-col gap-1" data-day={day}>
        <h3 className={cn('px-1 text-sm font-medium text-muted-foreground', isPlanned && 'opacity-60')}>
          {dayFormat.format(dayItems[0].dateValue)}
        </h3>
        <ul className="divide-y rounded-xl border">
          {dayItems.map(({ transaction }) => (
            <li key={transaction.id}>
              <TransactionRow
                transaction={transaction}
                planned={isPlanned}
                accountsById={accountsById}
                categoriesById={categoriesById}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </section>
    ));

  return (
    <div className="flex flex-col gap-4">
      {renderDays(planned, true)}
      {planned.length > 0 && happened.length > 0 && (
        // Where the page opens (see useTodayAnchor): planned transactions are above, a scroll up.
        <div
          data-today-anchor
          role="separator"
          aria-label={t('transactions.plannedSeparator', { count: planned.length })}
          className="flex items-center gap-3 py-1"
        >
          <span aria-hidden className="h-1 flex-1 rounded-full bg-border" />
          {/* The chevrons point at where the planned transactions are: above. */}
          <span aria-hidden className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
            <ChevronUpIcon className="size-4" />
            {t('transactions.plannedSeparator', { count: planned.length })}
            <ChevronUpIcon className="size-4" />
          </span>
          <span aria-hidden className="h-1 flex-1 rounded-full bg-border" />
        </div>
      )}
      {renderDays(happened, false)}
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
  // A transfer is named after where the money ended up — that's what the row is about — with the
  // account it left showing below it. Everything else is named after its category.
  const title = isTransfer
    ? (toAccount?.name ?? t('transactions.types.transfer'))
    : (category?.name ?? t('transactions.noCategory'));
  // Symbols rather than codes (₴, not UAH or грн.), as in the account list.
  const narrow = { currencyDisplay: 'narrowSymbol' } as const;
  const amount = formatMoney(transaction.amount, currencyCodes.get(transaction.currencyId), i18n.language, narrow);
  const destAmount =
    isTransfer && transaction.destAmount && toAccount
      ? formatMoney(transaction.destAmount, currencyCodes.get(toAccount.currencyId), i18n.language, narrow)
      : null;

  const content = (
    <>
      <AppearanceIcon
        icon={isTransfer ? toAccount?.icon : category?.icon}
        color={isTransfer ? toAccount?.color : category?.color}
        fallbackIcon={isTransfer ? 'wallet' : undefined}
        placeholder={isTransfer ? (toAccount ? undefined : 'transfer') : category ? undefined : 'none'}
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
              {/* The arrow points at the title above: this is where it came from. */}
              <ArrowRightIcon className="size-3.5 shrink-0" />
            </>
          )}
          {transaction.note && <span className="truncate"> · {transaction.note}</span>}
        </p>
        {transaction.isCustomized && (
          <div className="mt-1 flex gap-1">
            <Badge variant="secondary">{t('transactions.customized')}</Badge>
          </div>
        )}
      </div>
      <div className="text-right">
        <p
          className={cn('font-medium whitespace-nowrap tabular-nums', transactionTypeColor(transaction.type))}
        >
          {/* No + or −: the color already says which way the money went. */}
          {amount}
        </p>
        {destAmount && <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">→ {destAmount}</p>}
      </div>
    </>
  );

  // Planned (future-dated) rows are dimmed as a whole — text, amount and icon — so what already
  // happened stands out.
  const className = cn('flex w-full items-start gap-3 px-4 py-3 text-left', planned && 'text-muted-foreground opacity-60');
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
