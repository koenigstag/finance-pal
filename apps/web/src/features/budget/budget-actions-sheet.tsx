import { ChevronRightIcon, MinusCircleIcon, PencilIcon, ReceiptTextIcon, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { sectionOf, targetName, type BudgetLineRow } from './budget-model';

export type BudgetAction = 'change' | 'transactions' | 'remove';

interface BudgetActionsSheetProps {
  row?: BudgetLineRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUpdate: boolean;
  canDelete: boolean;
  onAction: (action: BudgetAction, row: BudgetLineRow) => void;
}

/**
 * What can be done with a line of the budget, opened by tapping it: a bottom sheet on phones, a
 * dialog from sm up.
 */
export function BudgetActionsSheet({ row, open, onOpenChange, canUpdate, canDelete, onAction }: BudgetActionsSheetProps) {
  const { t } = useTranslation();

  const actions: { action: BudgetAction; label: string; icon: LucideIcon }[] = [];
  if (canUpdate) {
    actions.push({ action: 'change', label: t('budget.actions.change'), icon: PencilIcon });
  }
  actions.push({ action: 'transactions', label: t('budget.actions.transactions'), icon: ReceiptTextIcon });
  if (canDelete) {
    actions.push({ action: 'remove', label: t('budget.actions.remove'), icon: MinusCircleIcon });
  }

  const appearance = row?.target.type === 'category' ? row.target.category : row?.target.account;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {row && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <AppearanceIcon
                  icon={appearance?.icon}
                  color={appearance?.color}
                  fallbackIcon={row.target.type === 'account' ? 'wallet' : undefined}
                  size="lg"
                />
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="truncate">{targetName(row.target)}</DialogTitle>
                  <DialogDescription className="truncate">{t(`budget.sections.${sectionOf(row.target)}`)}</DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <ul className="-mx-2 flex flex-col">
              {actions.map(({ action, label, icon: Icon }) => (
                <li key={action}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => onAction(action, row)}
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
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
