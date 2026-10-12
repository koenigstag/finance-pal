import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories, type Category } from '@/features/categories/queries';
import { useConversionLookup } from '@/features/currencies/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { useProfile } from '@/features/profile/queries';
import { parseMonthParam, shiftMonth, toMonthParam } from '@/lib/dates';
import { usePageMonth } from '@/lib/page-month';
import { useSwipeTrack } from '@/lib/swipe';
import { capitalizeFirst } from '@/lib/text';
import { BudgetActionsSheet, type BudgetAction } from './budget-actions-sheet';
import { BudgetAmountSheet } from './budget-amount-sheet';
import type { BudgetLineRow, BudgetTarget, BudgetViewInput } from './budget-model';
import { BudgetTargetPicker } from './budget-target-picker';
import { MonthBudget } from './month-budget';
import { useBudgets, type Budget } from './queries';
import { RemoveBudgetDialog } from './remove-budget-dialog';

export function BudgetPage() {
  const { t, i18n } = useTranslation();
  const { group, ability } = useGroupScope();
  const navigate = useNavigate();
  // Archived ones too: a line, or money in a month gone by, can belong to one put away since.
  const categories = useCategories(group.id, true);
  const accounts = useAccounts(group.id, true);
  const profile = useProfile();
  const lookup = useConversionLookup();
  const rate = useCallback<BudgetViewInput['rate']>(
    (from, to) => (from === to ? '1' : (lookup(from, to)?.rate ?? null)),
    [lookup],
  );

  const [picking, setPicking] = useState(false);
  const [amount, setAmount] = useState<{ open: boolean; target?: BudgetTarget; line?: Budget }>({ open: false });
  const [sheet, setSheet] = useState<{ open: boolean; row?: BudgetLineRow }>({ open: false });
  const [removing, setRemoving] = useState<{ open: boolean; row?: BudgetLineRow }>({ open: false });

  // In the URL, so a reload or the back button keeps the month; the same one as on the transactions
  // page and the overview.
  const { monthKey, goToMonth } = usePageMonth();
  // The month on screen and the ones either side of it, loaded and waiting just out of sight; a
  // move shifts which months those are, so there is no first or last month to stop at.
  const strip = useSwipeTrack({ count: 3, index: 1, position: monthKey, onCommit: goToMonth });
  const months = useMemo(() => [-1, 0, 1].map((delta) => shiftMonth(parseMonthParam(monthKey), delta)), [monthKey]);
  // Names the month the strip is nearest, so the name changes as a drag passes halfway.
  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(months[1 + strip.showing]),
    i18n.language,
  );
  // The month on screen's lines, for what the picker still offers; the panel reads the same cache.
  const lines = useBudgets(group.id, monthKey);

  const canCreate = ability.can('create', 'Budget');
  const canUpdate = ability.can('update', 'Budget');
  const canDelete = ability.can('delete', 'Budget');
  const showTransactions = (target: BudgetTarget) =>
    void navigate(
      `/g/${group.id}/transactions?month=${monthKey}&${target.type === 'category' ? `category=${target.category.id}` : `account=${target.account.id}`}`,
    );

  const onAction = (action: BudgetAction, row: BudgetLineRow) => {
    setSheet((current) => ({ ...current, open: false }));
    if (action === 'change') {
      setAmount({ open: true, target: row.target, line: row.line });
    } else if (action === 'remove') {
      setRemoving({ open: true, row });
    } else {
      showTransactions(row.target);
    }
  };
  // A category outside the budget: given an amount where that's allowed, otherwise its money is shown.
  const onSelectUnbudgeted = (category: Category) => {
    const target: BudgetTarget = { type: 'category', category };
    if (canCreate && !category.archived && category.parentId === null) {
      setAmount({ open: true, target });
    } else {
      showTransactions(target);
    }
  };

  return (
    // Fills the content area instead of growing past it, so only the month below scrolls.
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={t('budget.title')}
        action={canCreate ? { label: t('budget.add'), icon: PlusIcon, onClick: () => setPicking(true) } : undefined}
      >
        <div className="flex items-center justify-between gap-1 md:justify-start">
          <Button variant="ghost" size="icon" aria-label={t('budget.previousMonth')} onClick={() => strip.step(-1)}>
            <ChevronLeftIcon />
          </Button>
          <span aria-live="polite" className="min-w-40 flex-1 text-center font-medium md:flex-none">
            {monthLabel}
          </span>
          <Button variant="ghost" size="icon" aria-label={t('budget.nextMonth')} onClick={() => strip.step(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      </PageHeader>

      {/* Three months side by side, clipped to the one in the middle, as on the transactions page. */}
      <div {...strip.viewport} className="-mx-2 min-h-0 flex-1 overflow-hidden">
        <div style={strip.track} className="flex h-full w-full">
          {months.map((panelMonth, panel) => (
            <MonthBudget
              key={toMonthParam(panelMonth)}
              inert={panel !== 1}
              groupId={group.id}
              month={panelMonth}
              categories={categories.data ?? []}
              accounts={accounts.data ?? []}
              mainCurrencyId={profile.data?.mainCurrencyId}
              rate={rate}
              onAdd={canCreate ? () => setPicking(true) : undefined}
              onSelectLine={(row) => setSheet({ open: true, row })}
              onSelectUnbudgeted={onSelectUnbudgeted}
            />
          ))}
        </div>
      </div>

      <BudgetTargetPicker
        open={picking}
        onOpenChange={setPicking}
        categories={categories.data ?? []}
        accounts={accounts.data ?? []}
        lines={lines.data ?? []}
        onPick={(target) => {
          setPicking(false);
          setAmount({ open: true, target });
        }}
      />

      <BudgetAmountSheet
        groupId={group.id}
        open={amount.open}
        onOpenChange={(open) => setAmount((current) => ({ ...current, open }))}
        target={amount.target}
        line={amount.line}
        month={monthKey}
        monthLabel={monthLabel}
        mainCurrencyId={profile.data?.mainCurrencyId}
      />

      <BudgetActionsSheet
        row={sheet.row}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onAction={onAction}
      />

      <RemoveBudgetDialog
        groupId={group.id}
        row={removing.row}
        open={removing.open}
        onOpenChange={(open) => setRemoving((current) => ({ ...current, open }))}
      />
    </section>
  );
}
