import {
  ArrowLeftRightIcon,
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
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Account } from './queries';

export type AccountAction = 'edit' | 'transactions' | 'income' | 'expense' | 'transfer';

interface AccountActionsSheetProps {
  account?: Account;
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

/**
 * What can be done with an account, opened by tapping its row: a bottom sheet on phones (the
 * dialog's small-screen layout), a dialog from sm up.
 */
export function AccountActionsSheet({
  account,
  open,
  onOpenChange,
  canEdit,
  canAddTransactions,
  onAction,
}: AccountActionsSheetProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();

  const actions: ActionItem[] = [];
  if (canEdit) {
    actions.push({ action: 'edit', label: t('common.edit'), icon: PencilIcon });
  }
  actions.push({ action: 'transactions', label: t('nav.transactions'), icon: ReceiptTextIcon });
  if (canAddTransactions) {
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
                <div className="min-w-0 text-left">
                  <DialogTitle className="truncate">{account.name}</DialogTitle>
                  <DialogDescription className="tabular-nums">
                    {t(`accounts.types.${account.type}`)} ·{' '}
                    {formatMoney(account.balance, currencyCodes.get(account.currencyId), i18n.language)}
                  </DialogDescription>
                </div>
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
