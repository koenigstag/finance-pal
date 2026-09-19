import { ChevronLeftIcon, ChevronRightIcon, ListFilterIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { HeaderTools } from '@/components/header-tools';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { parseMonthParam, shiftMonth, toMonthParam } from '@/lib/dates';
import { useSwipeTrack } from '@/lib/swipe';
import { capitalizeFirst } from '@/lib/text';
import { useRecurringRules, type RecurringRule, type Transaction } from './queries';
import { DeleteTransactionDialog } from './delete-transaction-dialog';
import { MonthTransactions } from './month-transactions';
import { PlannedOccurrenceDialog, type PlannedOccurrenceAction } from './planned-occurrence-dialog';
import { TransactionActionsSheet, type TransactionAction } from './transaction-actions-sheet';
import { TransactionDateSheet } from './transaction-date-sheet';
import { TransactionDialog } from './transaction-dialog';
import { isPlannedDay } from './transaction-form-model';
import { TransactionFiltersSheet, type TransactionFilterValues } from './transaction-filters-sheet';

type TransactionType = (typeof TRANSACTION_TYPES)[number];

// Which URL parameter holds each filter.
const FILTER_PARAMS: Record<keyof TransactionFilterValues, string> = {
  search: 'q',
  accountId: 'account',
  type: 'type',
  categoryId: 'category',
};

export function TransactionsPage() {
  const { t, i18n } = useTranslation();
  const { group, ability } = useGroupScope();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts(group.id);
  const categories = useCategories(group.id);
  const rules = useRecurringRules(group.id);
  const rulesById = useMemo(() => new Map((rules.data ?? []).map((rule) => [rule.id, rule])), [rules.data]);
  const [dialog, setDialog] = useState<{
    open: boolean;
    transaction?: Transaction;
    template?: Transaction;
    rule?: RecurringRule;
  }>({ open: false });
  const [sheet, setSheet] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  const [deleting, setDeleting] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  const [dating, setDating] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  // Add now or Skip, for the occurrence a series is waiting on.
  const [settling, setSettling] = useState<{ open: boolean; action: PlannedOccurrenceAction; transaction?: Transaction }>({
    open: false,
    action: 'skip',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters live in the URL, so a reload, the back button or a shared link keep them.
  const month = parseMonthParam(params.get('month'));
  const monthKey = toMonthParam(month);
  const accountId = params.get('account') ?? undefined;
  const categoryId = params.get('category') ?? undefined;
  const typeParam = params.get('type');
  const type = TRANSACTION_TYPES.includes(typeParam as TransactionType) ? (typeParam as TransactionType) : undefined;
  const search = params.get('q') ?? '';

  // Sets or clears URL parameters in one navigation; undefined or '' clears.
  const updateParams = (patch: Record<string, string | undefined>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(patch)) {
          if (value) {
            next.set(name, value);
          } else {
            next.delete(name);
          }
        }
        return next;
      },
      { replace: true },
    );
  const setParam = (name: string, value: string | undefined) => updateParams({ [name]: value });

  // A month at a time, back or forward. The three months sit side by side in the order they
  // happened, so dragging the strip left brings the month after into view and dragging it right
  // the month before — the same way round as the chevrons either side of the month's name, which
  // step to a neighbour already on the strip and so have nothing to wait for.
  const goToMonth = (delta: number) => setParam('month', toMonthParam(shiftMonth(month, delta)));
  const strip = useSwipeTrack(monthKey, goToMonth);

  const filterValues: TransactionFilterValues = { search, accountId, type, categoryId };
  const onFiltersChange = (patch: Partial<TransactionFilterValues>) =>
    updateParams(
      Object.fromEntries(
        Object.entries(patch).map(([name, value]) => [FILTER_PARAMS[name as keyof TransactionFilterValues], value]),
      ),
    );

  // The month on screen and the ones either side of it, loaded and waiting just out of sight.
  const months = useMemo(
    () => [-1, 0, 1].map((delta) => shiftMonth(parseMonthParam(monthKey), delta)),
    [monthKey],
  );

  const activeFilterCount = [search, accountId, categoryId, type].filter(Boolean).length;
  const canCreate = ability.can('create', 'Transaction');
  const canUpdate = ability.can('update', 'Transaction');
  const canDelete = ability.can('delete', 'Transaction');
  // Delete on a planned occurrence ends its series (see TransactionActionsSheet).
  const canDeleteSeries = ability.can('delete', 'RecurringRule');
  // The running series a transaction is an occurrence of, if any.
  const ruleOf = (transaction?: Transaction) =>
    transaction?.recurringRuleId ? rulesById.get(transaction.recurringRuleId) : undefined;

  const onAction = (action: TransactionAction, transaction: Transaction) => {
    setSheet((current) => ({ ...current, open: false }));
    if (action === 'edit') {
      // A planned occurrence stands for its series: editing it edits the series from there on.
      // Anything recorded today or before is edited as itself, which no series edit ever touches.
      const rule = isPlannedDay(transaction.date) ? ruleOf(transaction) : undefined;
      setDialog(rule ? { open: true, rule } : { open: true, transaction });
    } else if (action === 'date') {
      setDating({ open: true, transaction });
    } else if (action === 'add-now' || action === 'skip') {
      setSettling({ open: true, action, transaction });
    } else if (action === 'duplicate') {
      setDialog({ open: true, template: transaction });
    } else {
      setDeleting({ open: true, transaction });
    }
  };
  // Names the month the strip is nearest rather than the one the URL still holds, so the name
  // changes as a half-finished drag passes the halfway mark and not a moment after it lands.
  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(months[1 + strip.showing]),
    i18n.language,
  );

  return (
    // Fills the content area instead of growing past it, so only the list below scrolls.
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={t('transactions.title')}
        action={canCreate ? { label: t('transactions.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      >
        <div className="flex items-center justify-between gap-1 md:justify-start">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('transactions.filters.previousMonth')}
            onClick={() => strip.step(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span aria-live="polite" className="min-w-40 flex-1 text-center font-medium md:flex-none">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('transactions.filters.nextMonth')}
            onClick={() => strip.step(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </PageHeader>

      <HeaderTools>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            activeFilterCount > 0
              ? t('transactions.filters.openActive', { count: activeFilterCount })
              : t('transactions.filters.title')
          }
          onClick={() => setFiltersOpen(true)}
          className="relative"
        >
          <ListFilterIcon />
          {activeFilterCount > 0 && (
            <Badge aria-hidden className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1.5">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </HeaderTools>

      {/*
        The strip: three months side by side, clipped to the one in the middle. The negative
        margin pays for the padding inside each panel, so the rows stay as wide as the page while
        a gutter opens between one month and the next as the strip is dragged across.
      */}
      <div {...strip.viewport} className="-mx-2 min-h-0 flex-1 overflow-hidden">
        <div style={strip.track} className="flex h-full w-full">
          {months.map((panelMonth) => (
            <MonthTransactions
              key={toMonthParam(panelMonth)}
              groupId={group.id}
              month={panelMonth}
              accountId={accountId}
              categoryId={categoryId}
              type={type}
              search={search}
              accounts={accounts.data ?? []}
              categories={categories.data ?? []}
              rules={rules.data ?? []}
              onSelect={canUpdate || canCreate || canDelete ? (transaction) => setSheet({ open: true, transaction }) : undefined}
            />
          ))}
        </div>
      </div>

      <TransactionFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        values={filterValues}
        onChange={onFiltersChange}
        onReset={() => updateParams({ q: undefined, account: undefined, type: undefined, category: undefined })}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
      />

      <TransactionActionsSheet
        transaction={sheet.transaction}
        rule={ruleOf(sheet.transaction)}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        canUpdate={canUpdate}
        canCreate={canCreate}
        canDelete={canDelete}
        canDeleteSeries={canDeleteSeries}
        onAction={onAction}
      />

      <DeleteTransactionDialog
        groupId={group.id}
        transaction={deleting.transaction}
        rule={ruleOf(deleting.transaction)}
        open={deleting.open}
        onOpenChange={(open) => setDeleting((current) => ({ ...current, open }))}
      />

      <PlannedOccurrenceDialog
        groupId={group.id}
        transaction={settling.transaction}
        action={settling.action}
        open={settling.open}
        onOpenChange={(open) => setSettling((current) => ({ ...current, open }))}
      />

      <TransactionDateSheet
        groupId={group.id}
        transaction={dating.transaction}
        rule={ruleOf(dating.transaction)}
        accounts={accounts.data ?? []}
        open={dating.open}
        onOpenChange={(open) => setDating((current) => ({ ...current, open }))}
      />

      <TransactionDialog
        groupId={group.id}
        transaction={dialog.transaction}
        rule={dialog.rule}
        template={dialog.template}
        defaultAccountId={accountId}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}
