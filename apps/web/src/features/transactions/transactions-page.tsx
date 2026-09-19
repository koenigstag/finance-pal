import { ChevronLeftIcon, ChevronRightIcon, ListFilterIcon, PlusIcon, ReceiptTextIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { HeaderTools } from '@/components/header-tools';
import { PAGE_BOTTOM_SPACE, PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { monthRange, parseMonthParam, shiftMonth, toMonthParam } from '@/lib/dates';
import { useSwipe } from '@/lib/swipe';
import { capitalizeFirst } from '@/lib/text';
import { cn } from '@/lib/utils';
import { useRecurringRules, useTransactionPages, type RecurringRule, type Transaction, type TransactionFilters } from './queries';
import { DeleteTransactionDialog } from './delete-transaction-dialog';
import { PlannedOccurrenceDialog, type PlannedOccurrenceAction } from './planned-occurrence-dialog';
import { TransactionActionsSheet, type TransactionAction } from './transaction-actions-sheet';
import { TransactionDateSheet } from './transaction-date-sheet';
import { TransactionDialog } from './transaction-dialog';
import { isPlannedDay } from './transaction-form-model';
import { TransactionList } from './transaction-list';
import { TransactionFiltersSheet, type TransactionFilterValues } from './transaction-filters-sheet';
import { useTodayAnchor } from './use-today-anchor';

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

  // A month at a time, back or forward: the chevrons beside the month's name, and — on a phone,
  // where there is no chevron under a thumb — a swipe across the list, each way pointing at the
  // chevron it stands for: left for the month before, right for the one after.
  const goToMonth = (delta: number) => setParam('month', toMonthParam(shiftMonth(month, delta)));
  const swipe = useSwipe((direction) => goToMonth(direction === 'left' ? -1 : 1));

  const filterValues: TransactionFilterValues = { search, accountId, type, categoryId };
  const onFiltersChange = (patch: Partial<TransactionFilterValues>) =>
    updateParams(
      Object.fromEntries(
        Object.entries(patch).map(([name, value]) => [FILTER_PARAMS[name as keyof TransactionFilterValues], value]),
      ),
    );

  const monthKey = toMonthParam(month);
  // The side the month on screen came in from, so it slides in from there however it was reached:
  // swiped, tapped or stepped back to with the browser's own back button.
  const [slide, setSlide] = useState<{ month: string; from: 'left' | 'right' | null }>({ month: monthKey, from: null });
  if (slide.month !== monthKey) {
    setSlide({ month: monthKey, from: monthKey < slide.month ? 'left' : 'right' });
  }
  const filters = useMemo<TransactionFilters>(
    () => ({ ...monthRange(parseMonthParam(monthKey)), accountId, categoryId, type, search: search || undefined }),
    [monthKey, accountId, categoryId, type, search],
  );
  const pages = useTransactionPages(group.id, filters);
  const loaded = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  // A month still to come reads forwards — the next thing due first — while this month and the
  // ones behind it read backwards, from what happened last. The API always answers newest first.
  const upcomingMonth = new Date(monthRange(month).dateFrom) > new Date();
  const transactions = useMemo(() => (upcomingMonth ? [...loaded].reverse() : loaded), [loaded, upcomingMonth]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The list opens on the separator before what already happened; planned transactions wait
  // above it, a scroll up. The title, month and filters above the list don't move.
  const anchorSpacer = useTodayAnchor(scrollerRef, JSON.stringify([group.id, filters]), pages.isSuccess);

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
  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(month),
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
            onClick={() => goToMonth(-1)}
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
            onClick={() => goToMonth(1)}
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

      {/* Swipeable, and never scrolling sideways itself: a month sliding in must not be reachable
          by dragging the list across. */}
      <div
        ref={scrollerRef}
        {...swipe}
        className={cn('-mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 scrollbar-none', PAGE_BOTTOM_SPACE)}
      >
        <div
          // Remounted with the month, which is what starts the slide over again.
          key={monthKey}
          className={cn(
            slide.from && 'duration-200 animate-in motion-reduce:animate-none',
            slide.from === 'left' && 'slide-in-from-left-6',
            slide.from === 'right' && 'slide-in-from-right-6',
          )}
        >
          {pages.isPending ? (
            <Spinner className="mx-auto size-6 text-muted-foreground" />
          ) : pages.isError ? (
            <QueryError onRetry={() => void pages.refetch()} />
          ) : transactions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ReceiptTextIcon />
                </EmptyMedia>
                <EmptyTitle>{t('transactions.empty.title')}</EmptyTitle>
                <EmptyDescription>{t('transactions.empty.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              <TransactionList
                transactions={transactions}
                accounts={accounts.data ?? []}
                categories={categories.data ?? []}
                rules={rules.data ?? []}
                onSelect={canUpdate || canCreate || canDelete ? (transaction) => setSheet({ open: true, transaction }) : undefined}
              />
              {pages.hasNextPage && (
                <LoadMore loading={pages.isFetchingNextPage} onLoadMore={() => void pages.fetchNextPage()} />
              )}
              {anchorSpacer > 0 && <div aria-hidden style={{ height: anchorSpacer }} />}
            </div>
          )}
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

// Loads the next page when the end of the list scrolls into view; the button covers browsers
// or layouts where that never happens.
function LoadMore({ loading, onLoadMore }: { loading: boolean; onLoadMore: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const element = ref.current;
    if (!element || loading) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadMoreRef.current();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  return (
    <div ref={ref} className="flex justify-center">
      <Button variant="outline" disabled={loading} onClick={onLoadMore}>
        {loading && <Spinner />}
        {t('transactions.loadMore')}
      </Button>
    </div>
  );
}
