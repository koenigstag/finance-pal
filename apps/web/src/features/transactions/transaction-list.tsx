import { format } from 'date-fns';
import { ChevronUpIcon, RepeatIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { transactionTypeColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { filedUnder } from './filed-under';
import type { RecurringRule, Transaction } from './queries';
import { repeatOf, useRepeatLabel } from './repeat';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  // The group's running series, for what a planned occurrence says about how often it comes.
  rules: RecurringRule[];
  // Absent for callers who can't edit: rows then render as plain, non-interactive items.
  onSelect?: (transaction: Transaction) => void;
}

/**
 * Transactions grouped under a heading per local calendar day, newest first as the API sorts them.
 * Planned (future-dated) ones come first, dimmed, then a separator counting them, then everything
 * that already happened. A day with both appears on each side of the separator. A series shows up
 * as its next occurrence, planned like any other, with a line saying how often it repeats.
 */
export function TransactionList({ transactions, accounts, categories, rules, onSelect }: TransactionListProps) {
  const { t, i18n } = useTranslation();
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
    [i18n.language],
  );
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const rulesById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
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
                rule={transaction.recurringRuleId ? rulesById.get(transaction.recurringRuleId) : undefined}
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
  // The series it's an occurrence of, while that one runs.
  rule?: RecurringRule;
  onSelect?: (transaction: Transaction) => void;
}

function TransactionRow({ transaction, planned, accountsById, categoriesById, rule, onSelect }: TransactionRowProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const repeatLabel = useRepeatLabel();
  // A planned occurrence stands for its series, so it says how often that repeats, on a line of
  // its own; another row still to come carries the mark by its name. Once one is recorded it says
  // nothing of the series: what happened happened, however it came about.
  const repeats = planned && rule ? repeatLabel(repeatOf(rule)) : null;
  const account = accountsById.get(transaction.accountId);
  const toAccount = transaction.toAccountId ? accountsById.get(transaction.toAccountId) : undefined;
  const isTransfer = transaction.type === 'transfer';

  const filed = filedUnder(transaction, (id) => categoriesById.get(id));
  // A transfer is named after where the money ended up — that's what the row is about — with the
  // account it left showing below it. Everything else is named after its category, and its
  // subcategory when it has one.
  const title = isTransfer
    ? (toAccount?.name ?? t('transactions.types.transfer'))
    : (filed?.name ?? t('transactions.noCategory'));
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
        icon={isTransfer ? toAccount?.icon : filed?.icon}
        color={isTransfer ? toAccount?.color : filed?.color}
        fallbackIcon={isTransfer ? 'wallet' : undefined}
        placeholder={isTransfer ? (toAccount ? undefined : 'transfer') : filed ? undefined : 'none'}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">
          {title}
          {planned && transaction.recurringRuleId && !repeats && (
            <RepeatIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('transactions.recurring')} />
          )}
        </p>
        {/* A transfer's source is half of what it is, so it reads brighter than a mere account line. */}
        <p className={cn('truncate text-sm', isTransfer ? 'text-foreground/80' : 'text-muted-foreground')}>
          {account?.name ?? '—'}
        </p>
        {transaction.note && <p className="truncate text-sm text-muted-foreground/70 italic">{transaction.note}</p>}
        {repeats && (
          <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <RepeatIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{repeats}</span>
          </p>
        )}
      </div>
      <div className="text-right">
        <p
          className={cn('font-medium whitespace-nowrap tabular-nums', transactionTypeColor(transaction.type))}
        >
          {/* No + or −: the color already says which way the money went. */}
          {amount}
        </p>
        {destAmount && <p className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{destAmount}</p>}
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
