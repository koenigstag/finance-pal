import { ArrowDownIcon, ArrowUpIcon, HandCoinsIcon, PiggyBankIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Account } from '@/features/accounts/queries';
import { categoriesUnder, type Category } from '@/features/categories/queries';
import { PickerRow } from '@/features/transactions/pickers';
import { SECTION_ORDER, type BudgetSectionKind, type BudgetTarget } from './budget-model';
import type { Budget } from './queries';

// The arrows the transaction and category pickers use for money out and in.
const TAB_ICONS: Record<BudgetSectionKind, LucideIcon> = {
  expense: ArrowDownIcon,
  income: ArrowUpIcon,
  savings: PiggyBankIcon,
  debt: HandCoinsIcon,
};

interface BudgetTargetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  accounts: Account[];
  // The month's lines: what has one already isn't offered again.
  lines: Budget[];
  onPick: (target: BudgetTarget) => void;
}

/**
 * The first step of adding to the budget: what the amount is for. A tab each for expense and income
 * categories (top-level ones: a subcategory's money counts toward its parent) and for savings and
 * debt accounts, listing whatever has no amount this month yet.
 */
export function BudgetTargetPicker({ open, onOpenChange, categories, accounts, lines, onPick }: BudgetTargetPickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BudgetSectionKind>('expense');

  // Every opening starts on expenses, what a budget is mostly about.
  useEffect(() => {
    if (open) {
      setTab('expense');
    }
  }, [open]);

  const taken = new Set(lines.map((line) => line.categoryId ?? line.accountId));
  const all =
    tab === 'expense' || tab === 'income'
      ? categoriesUnder(categories, tab, null).map((category): BudgetTarget => ({ type: 'category', category }))
      : accounts
          .filter((account) => account.type === tab && !account.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((account): BudgetTarget => ({ type: 'account', account }));
  const offered = all.filter((target) => !taken.has(target.type === 'category' ? target.category.id : target.account.id));
  const nothing =
    all.length === 0
      ? tab === 'savings'
        ? t('budget.picker.noSavings')
        : tab === 'debt'
          ? t('budget.picker.noDebts')
          : t('categories.empty.title')
      : t('budget.picker.allSet');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* One size for every tab: the sheet mustn't jump as the lists change length. */}
      <DialogContent className="flex h-[min(85svh,40rem)] flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('budget.picker.title')}</DialogTitle>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          className="grid w-full grid-cols-2 sm:grid-cols-4"
          value={tab}
          onValueChange={(value) => value && setTab(value as BudgetSectionKind)}
        >
          {SECTION_ORDER.map((option) => {
            const Icon = TAB_ICONS[option];
            return (
              <ToggleGroupItem key={option} value={option} className="min-w-0">
                <Icon />
                <span className="truncate">{t(`budget.picker.tabs.${option}`)}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {offered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{nothing}</p>
          ) : (
            <ul>
              {offered.map((target) =>
                target.type === 'category' ? (
                  <PickerRow
                    key={target.category.id}
                    selected={false}
                    onClick={() => onPick(target)}
                    icon={<AppearanceIcon icon={target.category.icon} color={target.category.color} />}
                    label={target.category.name}
                  />
                ) : (
                  <PickerRow
                    key={target.account.id}
                    selected={false}
                    onClick={() => onPick(target)}
                    icon={<AppearanceIcon icon={target.account.icon} color={target.account.color} fallbackIcon="wallet" />}
                    label={target.account.name}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
