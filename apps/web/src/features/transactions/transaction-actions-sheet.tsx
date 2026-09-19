import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RepeatIcon,
  SkipForwardIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { transactionTypeColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { filedUnder } from './filed-under';
import type { RecurringRule, Transaction } from './queries';
import { repeatOf, useRepeatLabel } from './repeat';
import { isPlannedOccurrence } from './transaction-form-model';

export type TransactionAction = 'edit' | 'date' | 'add-now' | 'skip' | 'duplicate' | 'delete';

interface TransactionActionsSheetProps {
  transaction?: Transaction;
  // The series the transaction is an occurrence of, while that one runs.
  rule?: RecurringRule;
  accounts: Account[];
  categories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whether the caller may edit, create and delete transactions; actions they can't take are left out.
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  // Deleting a planned occurrence deletes its series, which is a right of its own.
  canDeleteSeries: boolean;
  onAction: (action: TransactionAction, transaction: Transaction) => void;
}

interface ActionItem {
  action: TransactionAction;
  label: string;
  icon: LucideIcon;
  tone?: string;
}

/**
 * What can be done with a transaction, opened by tapping its row: a bottom sheet on phones (the
 * dialog's small-screen layout), a dialog from sm up. The same actions serve every transaction:
 * what editing or moving one reaches follows from its date (see TransactionDialog).
 *
 * The occurrence a running series is waiting on leads with two of its own: Add now records it
 * ahead of its date, Skip passes that date over, and either settles it so the series can plan the
 * one after (see PlannedOccurrenceDialog). Since Skip is what removing that one date means, Delete
 * there is the series': it ends the repetition and takes the planned transaction with it.
 */
export function TransactionActionsSheet({
  transaction,
  rule,
  accounts,
  categories,
  open,
  onOpenChange,
  canUpdate,
  canCreate,
  canDelete,
  canDeleteSeries,
  onAction,
}: TransactionActionsSheetProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const repeatLabel = useRepeatLabel();

  // Only the occurrence a running series waits on: the date it stands for is the one that can be
  // brought forward or passed over.
  const plannedOccurrence = !!transaction && isPlannedOccurrence(transaction, rule);

  const actions: ActionItem[] = [];
  if (plannedOccurrence && canUpdate) {
    actions.push({ action: 'add-now', label: t('transactions.actions.addNow'), icon: CheckIcon });
  }
  if (plannedOccurrence && canDelete) {
    actions.push({ action: 'skip', label: t('transactions.actions.skip'), icon: SkipForwardIcon });
  }
  if (canUpdate) {
    actions.push({ action: 'edit', label: t('common.edit'), icon: PencilIcon });
    actions.push({ action: 'date', label: t('transactions.actions.date'), icon: CalendarDaysIcon });
  }
  if (canCreate) {
    actions.push({
      action: 'duplicate',
      label: t('transactions.actions.duplicate'),
      icon: CopyIcon,
    });
  }
  if (plannedOccurrence ? canDeleteSeries : canDelete) {
    actions.push({
      action: 'delete',
      // Named for what it reaches, so a series is never ended by a button reading "Delete".
      label: t(plannedOccurrence ? 'transactions.actions.deleteSeries' : 'common.delete'),
      icon: Trash2Icon,
      tone: 'text-destructive',
    });
  }

  const account = transaction && accounts.find((candidate) => candidate.id === transaction.accountId);
  const toAccount = transaction?.toAccountId ? accounts.find((candidate) => candidate.id === transaction.toAccountId) : undefined;
  const filed = transaction && filedUnder(transaction, (id) => categories.find((candidate) => candidate.id === id));
  const isTransfer = transaction?.type === 'transfer';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {transaction && (
          <>
            <DialogHeader>
              <div className="flex min-w-0 items-center gap-3 pr-8">
                <AppearanceIcon
                  icon={filed?.icon}
                  color={filed?.color}
                  placeholder={isTransfer ? 'transfer' : filed ? undefined : 'none'}
                  size="lg"
                />
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">
                      {isTransfer ? t('transactions.types.transfer') : (filed?.name ?? t('transactions.noCategory'))}
                    </span>
                    {transaction.recurringRuleId && !rule && (
                      <RepeatIcon className="size-4 shrink-0 text-muted-foreground" aria-label={t('transactions.recurring')} />
                    )}
                  </DialogTitle>
                  {/* The date and the account it went through, a line each: names are long, and
                      a transfer carries two of them. */}
                  <DialogDescription asChild>
                    <div className="min-w-0">
                      <p className="truncate">
                        {new Intl.DateTimeFormat(i18n.language, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        }).format(new Date(transaction.date))}
                      </p>
                      {rule && (
                        <p className="flex min-w-0 items-center gap-1">
                          <RepeatIcon aria-hidden className="size-3.5 shrink-0" />
                          <span className="truncate">{repeatLabel(repeatOf(rule))}</span>
                        </p>
                      )}
                      <p className="truncate">{account?.name ?? '—'}</p>
                      {/* The other side of a transfer gets its own line too, rather than two
                          half-readable names sharing one. */}
                      {isTransfer && (
                        <p className="flex min-w-0 items-center gap-1">
                          <ArrowRightIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{toAccount?.name ?? '—'}</span>
                        </p>
                      )}
                    </div>
                  </DialogDescription>
                </div>
              </div>
              {/* A line of its own: account names leave no room beside them, least of all for a
                  transfer, which names two. */}
              <p className={cn('text-left text-lg font-semibold tabular-nums', transactionTypeColor(transaction.type))}>
                {formatMoney(transaction.amount, currencyCodes.get(transaction.currencyId), i18n.language, {
                  currencyDisplay: 'narrowSymbol',
                })}
              </p>
              {/* Italic, as a note reads everywhere: in the list, and in the field it's typed in. */}
              {transaction.note && (
                <p className="text-left text-sm break-words whitespace-pre-line italic">{transaction.note}</p>
              )}
            </DialogHeader>
            <ul className="-mx-2 flex flex-col">
              {actions.map(({ action, label, icon: Icon, tone }) => (
                <li key={action}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => onAction(action, transaction)}
                  >
                    <span className={cn('flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4', tone)}>
                      <Icon />
                    </span>
                    <span className={cn('flex-1 font-medium', tone)}>{label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
