import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories, type Category } from '@/features/categories/queries';
import { useConversionLookup } from '@/features/currencies/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { useProfile } from '@/features/profile/queries';
import { parseMonthParam, shiftMonth, toMonthParam } from '@/lib/dates';
import { usePageMonth } from '@/lib/page-month';
import { useSwipeTrack } from '@/lib/swipe';
import { capitalizeFirst } from '@/lib/text';
import { MonthOverview } from './month-overview';
import { OVERVIEW_TYPES, type OverviewType, type OverviewViewInput } from './overview-model';

export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const { group } = useGroupScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Archived ones too: money in a month gone by can belong to one put away since.
  const categories = useCategories(group.id, true);
  const accounts = useAccounts(group.id, true);
  const profile = useProfile();
  const lookup = useConversionLookup();
  const rate = useCallback<OverviewViewInput['rate']>(
    (from, to) => (from === to ? '1' : (lookup(from, to)?.rate ?? null)),
    [lookup],
  );

  // In the URL, so a reload or the back button keeps the month; the same one as on the transactions
  // page and the budget.
  const { monthKey, goToMonth } = usePageMonth();
  // The tab too. Expenses are where the page opens, and need no parameter.
  const type: OverviewType = params.get('type') === 'income' ? 'income' : 'expense';
  const setType = (next: OverviewType) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'expense') {
          updated.delete('type');
        } else {
          updated.set('type', next);
        }
        return updated;
      },
      { replace: true },
    );

  // The month on screen and the ones either side of it, loaded and waiting just out of sight, as on
  // the transactions page; a move shifts which months those are, so there is no first or last.
  const strip = useSwipeTrack({ count: 3, index: 1, position: monthKey, onCommit: goToMonth });
  const months = useMemo(() => [-1, 0, 1].map((delta) => shiftMonth(parseMonthParam(monthKey), delta)), [monthKey]);
  // Names the month the strip is nearest, so the name changes as a drag passes halfway.
  const monthLabel = capitalizeFirst(
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(months[1 + strip.showing]),
    i18n.language,
  );

  // The month's transactions behind a category's row.
  const showTransactions = (category: Category) =>
    void navigate(`/g/${group.id}/transactions?month=${monthKey}&category=${category.id}`);

  return (
    // Fills the content area instead of growing past it, so only the month below scrolls.
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={t('overview.title')}>
        <div className="flex items-center justify-between gap-1 md:justify-start">
          <Button variant="ghost" size="icon" aria-label={t('overview.previousMonth')} onClick={() => strip.step(-1)}>
            <ChevronLeftIcon />
          </Button>
          <span aria-live="polite" className="min-w-40 flex-1 text-center font-medium md:flex-none">
            {monthLabel}
          </span>
          <Button variant="ghost" size="icon" aria-label={t('overview.nextMonth')} onClick={() => strip.step(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      </PageHeader>

      <Tabs
        value={type}
        onValueChange={(value) => setType(value as OverviewType)}
        className="min-h-0 flex-1 gap-4"
      >
        <TabsList className="w-full shrink-0 md:w-80">
          {OVERVIEW_TYPES.map((option) => (
            <TabsTrigger key={option} value={option}>
              {t(`overview.tabs.${option}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={type} className="flex min-h-0 flex-col">
          {/* Three months side by side, clipped to the one in the middle, as on the transactions page. */}
          <div {...strip.viewport} className="-mx-2 min-h-0 flex-1 overflow-hidden">
            <div style={strip.track} className="flex h-full w-full">
              {months.map((panelMonth, panel) => (
                <MonthOverview
                  key={toMonthParam(panelMonth)}
                  inert={panel !== 1}
                  groupId={group.id}
                  month={panelMonth}
                  type={type}
                  categories={categories.data ?? []}
                  accounts={accounts.data ?? []}
                  mainCurrencyId={profile.data?.mainCurrencyId}
                  rate={rate}
                  onSelectCategory={showTransactions}
                />
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
