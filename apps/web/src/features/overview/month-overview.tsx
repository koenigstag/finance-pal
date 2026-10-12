import { startOfDay } from 'date-fns';
import { ChartColumnIcon, ChevronDownIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { PAGE_BOTTOM_SPACE } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { toMonthParam } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { DailyChart } from './daily-chart';
import {
  buildOverview,
  foldRows,
  NEUTRAL_COLOR,
  sourceColor,
  type OverviewRow,
  type OverviewSource,
  type OverviewType,
  type OverviewViewInput,
} from './overview-model';
import { useOverviewDays } from './queries';

// What a row can lead to: a category, or a debt. Money with no category has nowhere to go.
export type SelectableSource = Exclude<OverviewSource, { kind: 'none' }>;

interface MonthOverviewProps {
  groupId: string;
  // The first of the month this panel is about.
  month: Date;
  type: OverviewType;
  categories: Category[];
  accounts: Account[];
  // The signed-in person's, which everything is in; unknown while loading.
  mainCurrencyId: number | undefined;
  rate: OverviewViewInput['rate'];
  // A category's or a debt's row leads to the transactions behind it.
  onSelect: (source: SelectableSource) => void;
  // Set on a panel waiting off to the side: it can be seen, but not read out or tabbed into.
  inert?: boolean;
}

/**
 * One month of the overview, scrolling on its own: what was spent, or received, day by day, what
 * that comes to on average and in all, and how it divides between categories and debts.
 */
export function MonthOverview({
  groupId,
  month,
  type,
  categories,
  accounts,
  mainCurrencyId,
  rate,
  onSelect,
  inert,
}: MonthOverviewProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const days = useOverviewDays(groupId, toMonthParam(month));
  const now = new Date();
  // The start of today: the averages move on with the date, not with every render.
  const today = startOfDay(now).getTime();

  const view = useMemo(
    () =>
      days.data && mainCurrencyId !== undefined
        ? buildOverview({ days: days.data, month, now: new Date(today), categories, accounts, mainCurrencyId, rate })
        : null,
    [days.data, month, today, categories, accounts, mainCurrencyId, rate],
  );
  const tab = view?.[type];
  const money = (amount: string) =>
    formatMoney(amount, currencyCodes.get(mainCurrencyId ?? -1), i18n.language, { currencyDisplay: 'narrowSymbol' });
  const sources = useMemo(() => new Map(tab?.rows.map((row) => [row.key, row.source])), [tab]);
  const nameOf = (source: OverviewSource | undefined) =>
    source?.kind === 'category' ? source.category.name : source?.kind === 'debt' ? source.account.name : t('overview.noCategory');
  const isThisMonth = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const monthName = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(month);

  return (
    <div inert={inert} className={cn('w-full shrink-0 overflow-y-auto px-2 scrollbar-none', PAGE_BOTTOM_SPACE)}>
      {days.isPending || (days.isSuccess && !view) ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : days.isError || !view || !tab ? (
        <QueryError onRetry={() => void days.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {tab.rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChartColumnIcon />
                </EmptyMedia>
                <EmptyTitle>{t(`overview.empty.${type}`)}</EmptyTitle>
                <EmptyDescription>{t('overview.empty.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <DailyChart
                // A day picked on one tab means nothing on the other.
                key={type}
                days={tab.days}
                month={month}
                today={isThisMonth ? now.getDate() : null}
                colorOf={(key) => {
                  const source = sources.get(key);
                  return source ? sourceColor(source) : NEUTRAL_COLOR;
                }}
                nameOf={(key) => nameOf(sources.get(key))}
                money={money}
                label={t(`overview.chartLabel.${type}`, { month: monthName })}
              />
              <dl className="grid grid-cols-3 gap-2">
                <Stat label={t('overview.perDay')} value={tab.perDay === null ? '—' : money(tab.perDay)} />
                <Stat label={t('overview.perWeek')} value={tab.perWeek === null ? '—' : money(tab.perWeek)} />
                <Stat label={t('overview.month')} value={money(tab.total)} />
              </dl>
              <Rows rows={tab.rows} money={money} nameOf={nameOf} onSelect={onSelect} />
            </>
          )}
          {view.missingCurrencyIds.length > 0 && (
            <Alert>
              <AlertDescription>
                {t('overview.missingRates', {
                  codes: view.missingCurrencyIds.map((id) => currencyCodes.get(id) ?? '?').join(', '),
                })}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}

// Stacked rather than side by side: the label above, the figure under it.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-2">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Rows({
  rows,
  money,
  nameOf,
  onSelect,
}: {
  rows: OverviewRow[];
  money: (amount: string) => string;
  nameOf: (source: OverviewSource) => string;
  onSelect: (source: SelectableSource) => void;
}) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = foldRows(rows);
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 });

  return (
    <ul className="divide-y rounded-xl border">
      {shown.map((row) => (
        <li key={row.key}>
          <Row row={row} money={money} name={nameOf(row.source)} percent={percent} onSelect={onSelect} />
        </li>
      ))}
      {more && (
        <li>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-muted/50"
            onClick={() => setExpanded((current) => !current)}
          >
            {/* The chevron where the others have their icon, so the bars and shares stay in line. */}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
              <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
            </span>
            <RowBody
              name={t('overview.more')}
              amount={money(more.total)}
              share={more.share}
              color={NEUTRAL_COLOR}
              percent={percent}
            />
          </button>
          {expanded && (
            <ul id={listId} className="divide-y border-t">
              {more.rows.map((row) => (
                <li key={row.key}>
                  <Row row={row} money={money} name={nameOf(row.source)} percent={percent} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </li>
      )}
    </ul>
  );
}

function Row({
  row,
  money,
  name,
  percent,
  onSelect,
}: {
  row: OverviewRow;
  money: (amount: string) => string;
  name: string;
  percent: Intl.NumberFormat;
  onSelect: (source: SelectableSource) => void;
}) {
  const { t } = useTranslation();
  const { source } = row;
  const icon =
    source.kind === 'category' ? (
      <AppearanceIcon icon={source.category.icon} color={source.category.color} />
    ) : source.kind === 'debt' ? (
      <AppearanceIcon icon={source.account.icon} color={source.account.color} fallbackIcon="wallet" />
    ) : (
      <AppearanceIcon placeholder="none" />
    );
  const body = (
    <>
      {icon}
      <RowBody
        name={name}
        note={source.kind === 'debt' ? t('overview.debt') : undefined}
        amount={money(row.total)}
        share={row.share}
        color={sourceColor(source)}
        percent={percent}
      />
    </>
  );
  const layout = 'flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left';

  // Money with no category has no filter to lead to.
  return source.kind === 'none' ? (
    <div className={layout}>{body}</div>
  ) : (
    <button type="button" className={cn(layout, 'hover:bg-muted/50')} onClick={() => onSelect(source)}>
      {body}
    </button>
  );
}

function RowBody({
  name,
  note,
  amount,
  share,
  color,
  percent,
}: {
  name: string;
  note?: string;
  amount: string;
  share: number;
  color: string;
  percent: Intl.NumberFormat;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          {note && <p className="truncate text-sm text-muted-foreground">{note}</p>}
        </div>
        <p className="font-medium whitespace-nowrap tabular-nums">{amount}</p>
      </div>
      <div className="flex items-center gap-3">
        <div aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, backgroundColor: color }} />
        </div>
        <p className="w-12 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums">{percent.format(share)}</p>
      </div>
    </div>
  );
}
