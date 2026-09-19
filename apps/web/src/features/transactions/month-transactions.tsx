import { ReceiptTextIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGE_BOTTOM_SPACE } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { monthRange, parseMonthParam, toMonthParam } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useTransactionPages, type RecurringRule, type Transaction, type TransactionFilters } from './queries';
import { TransactionList } from './transaction-list';
import { useTodayAnchor } from './use-today-anchor';

interface MonthTransactionsProps {
  groupId: string;
  // The first of the month this panel is about.
  month: Date;
  // Everything the page filters by apart from the month, which is this panel's own.
  accountId?: string;
  categoryId?: string;
  type?: TransactionFilters['type'];
  search: string;
  accounts: Account[];
  categories: Category[];
  rules: RecurringRule[];
  // Absent for callers who can't edit: rows then render as plain, non-interactive items.
  onSelect?: (transaction: Transaction) => void;
}

/**
 * One month of the ledger, scrolling on its own.
 *
 * Three of these sit side by side on the transactions page — the month on screen and the ones
 * either side of it — so a swipe reveals a month that has already loaded and found its place,
 * rather than an empty panel that starts fetching when it comes into view. Each keeps its own
 * scroll position, its own pages of history and its own anchor on today.
 */
export function MonthTransactions({
  groupId,
  month,
  accountId,
  categoryId,
  type,
  search,
  accounts,
  categories,
  rules,
  onSelect,
}: MonthTransactionsProps) {
  const { t } = useTranslation();
  const monthKey = toMonthParam(month);
  const filters = useMemo<TransactionFilters>(
    () => ({ ...monthRange(parseMonthParam(monthKey)), accountId, categoryId, type, search: search || undefined }),
    [monthKey, accountId, categoryId, type, search],
  );
  const pages = useTransactionPages(groupId, filters);
  const loaded = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  // A month still to come reads forwards — the next thing due first — while this month and the
  // ones behind it read backwards, from what happened last. The API always answers newest first.
  const upcomingMonth = new Date(monthRange(month).dateFrom) > new Date();
  const transactions = useMemo(() => (upcomingMonth ? [...loaded].reverse() : loaded), [loaded, upcomingMonth]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The panel opens on the separator before what already happened; planned transactions wait
  // above it, a scroll up. Nothing outside this panel moves with it.
  const anchorSpacer = useTodayAnchor(scrollerRef, JSON.stringify([groupId, filters]), pages.isSuccess);

  return (
    <div
      ref={scrollerRef}
      // A panel of the strip: as wide as the page, never squeezed by the two beside it, and
      // scrolling up and down by itself.
      className={cn('w-full shrink-0 overflow-y-auto px-2 scrollbar-none', PAGE_BOTTOM_SPACE)}
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
            accounts={accounts}
            categories={categories}
            rules={rules}
            onSelect={onSelect}
          />
          {pages.hasNextPage && <LoadMore loading={pages.isFetchingNextPage} onLoadMore={() => void pages.fetchNextPage()} />}
          {anchorSpacer > 0 && <div aria-hidden style={{ height: anchorSpacer }} />}
        </div>
      )}
    </div>
  );
}

// Loads the next page when the end of the list scrolls into view; the button covers browsers
// or layouts where that never happens. A panel waiting off to the side is clipped away, so it
// never counts as in view and never loads more until it is swiped to.
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
