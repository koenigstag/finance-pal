import { ChevronLeftIcon, ChevronRightIcon, ListFilterIcon, PlusIcon, ReceiptTextIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAccounts } from '@/features/accounts/queries';
import { categoryOptions, useCategories } from '@/features/categories/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { monthRange, parseMonthParam, shiftMonth, toMonthParam } from '@/lib/dates';
import { capitalizeFirst } from '@/lib/text';
import { cn } from '@/lib/utils';
import { useTransactionPages, type Transaction, type TransactionFilters } from './queries';
import { TransactionDialog } from './transaction-dialog';
import { TransactionList } from './transaction-list';
import { TRANSACTION_TYPE_ORDER } from './transaction-types';

// Select items can't have an empty value; this one means "no filter".
const ALL = 'all';
const SEARCH_DEBOUNCE_MS = 300;

type TransactionType = (typeof TRANSACTION_TYPES)[number];

export function TransactionsPage() {
  const { t, i18n } = useTranslation();
  const { group, ability } = useGroupScope();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts(group.id);
  const categories = useCategories(group.id);
  const [dialog, setDialog] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  // Phones show only the month and search until asked; the other filters take a screenful.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters live in the URL, so a reload, the back button or a shared link keep them.
  const month = parseMonthParam(params.get('month'));
  const accountId = params.get('account') ?? undefined;
  const categoryId = params.get('category') ?? undefined;
  const typeParam = params.get('type');
  const type = TRANSACTION_TYPES.includes(typeParam as TransactionType) ? (typeParam as TransactionType) : undefined;
  const search = params.get('q') ?? '';

  const setParam = (name: string, value: string | undefined) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) {
          next.set(name, value);
        } else {
          next.delete(name);
        }
        return next;
      },
      { replace: true },
    );

  const monthKey = toMonthParam(month);
  const filters = useMemo<TransactionFilters>(
    () => ({ ...monthRange(parseMonthParam(monthKey)), accountId, categoryId, type, search: search || undefined }),
    [monthKey, accountId, categoryId, type, search],
  );
  const pages = useTransactionPages(group.id, filters);
  const transactions = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);

  const activeFilterCount = [accountId, categoryId, type].filter(Boolean).length;
  const canCreate = ability.can('create', 'Transaction');
  const canUpdate = ability.can('update', 'Transaction');
  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(month),
    i18n.language,
  );
  const categoryFilterOptions = useMemo(
    () =>
      type === 'transfer'
        ? []
        : (type ? [type] : (['income', 'expense'] as const)).flatMap((categoryType) =>
            categoryOptions(categories.data ?? [], categoryType),
          ),
    [categories.data, type],
  );

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t('transactions.title')}
        action={canCreate ? { label: t('transactions.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      />

      <div className="flex items-center justify-between gap-1 md:justify-start">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('transactions.filters.previousMonth')}
          onClick={() => setParam('month', toMonthParam(shiftMonth(month, -1)))}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-40 flex-1 text-center font-medium md:flex-none">{monthLabel}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('transactions.filters.nextMonth')}
          onClick={() => setParam('month', toMonthParam(shiftMonth(month, 1)))}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      <div className="flex gap-2 md:hidden">
        <div className="flex-1">
          <SearchInput value={search} onChange={(value) => setParam('q', value || undefined)} />
        </div>
        <Button
          variant="outline"
          aria-expanded={filtersOpen}
          aria-controls="transaction-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilterIcon />
          {t('transactions.filters.toggle')}
          {activeFilterCount > 0 && <Badge className="ml-0.5 h-5 min-w-5 px-1.5">{activeFilterCount}</Badge>}
        </Button>
      </div>

      <div
        id="transaction-filters"
        className={cn('grid-cols-1 gap-2 md:grid md:grid-cols-2 lg:grid-cols-4', filtersOpen ? 'grid' : 'hidden')}
      >
        <div className="hidden md:block">
          <SearchInput value={search} onChange={(value) => setParam('q', value || undefined)} />
        </div>
        <Select value={accountId ?? ALL} onValueChange={(value) => setParam('account', value === ALL ? undefined : value)}>
          <SelectTrigger className="w-full" aria-label={t('transactions.account')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('transactions.filters.allAccounts')}</SelectItem>
            {accounts.data?.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" size="sm" />
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={type ?? ALL}
          onValueChange={(value) =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                if (value === ALL) {
                  next.delete('type');
                } else {
                  next.set('type', value);
                }
                // A category belongs to one type; keeping it across a type change could only
                // filter everything out.
                next.delete('category');
                return next;
              },
              { replace: true },
            )
          }
        >
          <SelectTrigger className="w-full" aria-label={t('transactions.filters.type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('transactions.filters.allTypes')}</SelectItem>
            {TRANSACTION_TYPE_ORDER.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`transactions.types.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={categoryId ?? ALL}
          onValueChange={(value) => setParam('category', value === ALL ? undefined : value)}
          disabled={type === 'transfer'}
        >
          <SelectTrigger className="w-full" aria-label={t('transactions.category')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('transactions.filters.allCategories')}</SelectItem>
            {categoryFilterOptions.map(({ category, depth }) => (
              <SelectItem key={category.id} value={category.id}>
                <span className="flex items-center gap-2" style={{ paddingInlineStart: `${depth}rem` }}>
                  <AppearanceIcon icon={category.icon} color={category.color} size="sm" />
                  {category.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
        <>
          <TransactionList
            transactions={transactions}
            accounts={accounts.data ?? []}
            categories={categories.data ?? []}
            onSelect={canUpdate ? (transaction) => setDialog({ open: true, transaction }) : undefined}
          />
          {pages.hasNextPage && (
            <LoadMore loading={pages.isFetchingNextPage} onLoadMore={() => void pages.fetchNextPage()} />
          )}
        </>
      )}

      <TransactionDialog
        groupId={group.id}
        transaction={dialog.transaction}
        defaultAccountId={accountId}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}

// Typing updates the field at once but the URL (and so the query) only after a pause.
function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow outside changes, e.g. back navigation to a different search — but not our own echo,
  // which would eat a trailing space mid-typing ("coffee " → "coffee").
  useEffect(() => setDraft((current) => (current.trim() === value ? current : value)), [value]);

  useEffect(() => {
    if (draft.trim() === value) {
      return;
    }
    const timer = setTimeout(() => onChangeRef.current(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <Input
      type="search"
      placeholder={t('transactions.filters.search')}
      aria-label={t('transactions.filters.search')}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
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
