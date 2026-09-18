import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  ReceiptTextIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { pickDefaultAccountId } from '@/features/transactions/transaction-form-model';
import { formatMoney, moneySign } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { FavouriteToggle } from './favourite-toggle';
import type { Account } from './queries';
import { useFavouriteToggle } from './use-favourite-toggle';

// give and receive are a debt account's: money from you to the person, and from them to you.
export type AccountAction = 'edit' | 'transactions' | 'income' | 'expense' | 'transfer' | 'give' | 'receive';

interface AccountActionsSheetProps {
  groupId: string;
  // The group's accounts as currently cached, and which of them the sheet is for.
  accounts: Account[];
  accountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whether the caller may edit accounts and add transactions; actions they can't take are left out.
  canEdit: boolean;
  canAddTransactions: boolean;
  onAction: (action: AccountAction, account: Account) => void;
}

interface ActionItem {
  action: AccountAction;
  label: string;
  icon: LucideIcon;
  tone?: string;
}

// Where a debt stands, by its balance: yours to repay, owed to you, or settled.
function debtStanding(balance: string): 'owe' | 'owed' | 'settled' {
  const sign = moneySign(balance);
  return sign < 0 ? 'owe' : sign > 0 ? 'owed' : 'settled';
}

/**
 * What can be done with an account, opened by tapping its row: a bottom sheet on phones (the
 * dialog's small-screen layout), a dialog from sm up.
 */
export function AccountActionsSheet({
  groupId,
  accounts,
  accountId,
  open,
  onOpenChange,
  canEdit,
  canAddTransactions,
  onAction,
}: AccountActionsSheetProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const toggleFavourite = useFavouriteToggle(groupId);
  const account = accounts.find((candidate) => candidate.id === accountId);
  // The favourite is the starred account, or the first one when none is.
  const favouriteId = pickDefaultAccountId(accounts);
  const isFavourite = !!account && account.id === favouriteId;
  // Unstarring the account that's the default anyway (when none is starred) would change nothing,
  // so its filled star stays put.
  const fallbackId = pickDefaultAccountId(accounts.map((candidate) => ({ ...candidate, isFavourite: false })));
  const canToggleFavourite = canEdit && !(isFavourite && account?.id === fallbackId);

  const actions: ActionItem[] = [];
  if (canEdit) {
    actions.push({ action: 'edit', label: t('common.edit'), icon: PencilIcon });
  }
  actions.push({ action: 'transactions', label: t('nav.transactions'), icon: ReceiptTextIcon });
  if (canAddTransactions && account?.type === 'debt') {
    // Money changing hands with a person, as a transfer between them and one of your accounts, so
    // your side moves too. Each action always goes the same way, out from you or in to you, and
    // only its name follows the balance: out is lending while they owe you, paying back while you
    // owe them.
    const sign = moneySign(account.balance);
    const outLabel = sign > 0 ? 'lendMore' : sign < 0 ? 'payBack' : 'lend';
    const inLabel = sign > 0 ? 'gotPaidBack' : sign < 0 ? 'borrowMore' : 'borrow';
    actions.push(
      { action: 'give', label: t(`accounts.debtActions.${outLabel}`), icon: ArrowUpRightIcon, tone: 'text-destructive' },
      {
        action: 'receive',
        label: t(`accounts.debtActions.${inLabel}`),
        icon: ArrowDownLeftIcon,
        tone: 'text-emerald-600 dark:text-emerald-400',
      },
    );
  } else if (canAddTransactions) {
    actions.push(
      { action: 'income', label: t('transactions.types.income'), icon: PlusIcon, tone: 'text-emerald-600 dark:text-emerald-400' },
      { action: 'expense', label: t('transactions.types.expense'), icon: MinusIcon, tone: 'text-destructive' },
    );
    // Debt and savings accounts are tracked by what's recorded on them directly; transfers belong
    // to regular accounts.
    if (account?.type === 'regular') {
      actions.push({ action: 'transfer', label: t('transactions.types.transfer'), icon: ArrowLeftRightIcon });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {account && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" size="lg" />
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="truncate">{account.name}</DialogTitle>
                  {/* What kind of account on one line — for a debt, which way it runs — and what it
                      holds on the next, colored like the list. */}
                  <DialogDescription asChild>
                    <div>
                      <p>
                        {account.type === 'debt'
                          ? t(`accounts.groups.${debtStanding(account.balance)}`)
                          : t(`accounts.types.${account.type}`)}
                      </p>
                      <p className={cn('font-medium tabular-nums', signColor(moneySign(account.balance)))}>
                        {formatMoney(account.balance, currencyCodes.get(account.currencyId), i18n.language, {
                          currencyDisplay: 'narrowSymbol',
                        })}
                      </p>
                    </div>
                  </DialogDescription>
                </div>
                {canEdit ? (
                  <FavouriteToggle
                    favourite={isFavourite}
                    disabled={!canToggleFavourite}
                    onToggle={() => toggleFavourite(account.id)}
                  />
                ) : (
                  isFavourite && <FavouriteToggle favourite disabled onToggle={() => undefined} />
                )}
              </div>
            </DialogHeader>
            <ul className="-mx-2 flex flex-col">
              {actions.map(({ action, label, icon: Icon, tone }) => (
                <li key={action}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => onAction(action, account)}
                  >
                    <span className={cn('flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4', tone)}>
                      <Icon />
                    </span>
                    <span className="flex-1 font-medium">{label}</span>
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
