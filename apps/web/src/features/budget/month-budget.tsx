import { ChevronDownIcon, ListIcon, PiggyBankIcon, PlusIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { PAGE_BOTTOM_SPACE } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { toMonthParam } from '@/lib/dates';
import { formatMoney, moneySign } from '@/lib/money';
import { MONEY_COLORS } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { BudgetBar } from './budget-bar';
import {
  buildBudgetView,
  negate,
  targetName,
  type BudgetLineRow,
  type BudgetSection,
  type BudgetSectionKind,
  type BudgetViewInput,
} from './budget-model';
import { useBudgets, useBudgetTotals } from './queries';

interface MonthBudgetProps {
  groupId: string;
  // The first of the month this panel is about.
  month: Date;
  categories: Category[];
  accounts: Account[];
  mainCurrencyId: number | undefined;
  rate: BudgetViewInput['rate'];
  // Absent for callers who can't add to the budget.
  onAdd?: () => void;
  onSelectLine: (row: BudgetLineRow) => void;
  onSelectUnbudgeted: (category: Category) => void;
  // Set on a panel waiting off to the side: it can be seen, but not read out or tabbed into.
  inert?: boolean;
}

/**
 * One month of the budget, scrolling on its own: a section each for expenses, income, savings and
 * debts, every line with a bar for how far it has got, and under the categories whatever had money
 * without being budgeted, folded into one row.
 */
export function MonthBudget({
  groupId,
  month,
  categories,
  accounts,
  mainCurrencyId,
  rate,
  onAdd,
  onSelectLine,
  onSelectUnbudgeted,
  inert,
}: MonthBudgetProps) {
  const { t } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const monthKey = toMonthParam(month);
  const lines = useBudgets(groupId, monthKey);
  const totals = useBudgetTotals(groupId, monthKey);

  const view = useMemo(
    () =>
      lines.data && totals.data
        ? buildBudgetView({ lines: lines.data, totals: totals.data, categories, accounts, mainCurrencyId, rate })
        : null,
    [lines.data, totals.data, categories, accounts, mainCurrencyId, rate],
  );
  const hasLines = view?.sections.some((section) => section.lines.length > 0) ?? false;

  return (
    <div inert={inert} className={cn('w-full shrink-0 overflow-y-auto px-2 scrollbar-none', PAGE_BOTTOM_SPACE)}>
      {lines.isPending || totals.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : lines.isError || totals.isError || !view ? (
        <QueryError
          onRetry={() => {
            void lines.refetch();
            void totals.refetch();
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {!hasLines && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PiggyBankIcon />
                </EmptyMedia>
                <EmptyTitle>{t('budget.empty.title')}</EmptyTitle>
                <EmptyDescription>{onAdd ? t('budget.empty.description') : t('budget.empty.readOnly')}</EmptyDescription>
              </EmptyHeader>
              {onAdd && (
                <EmptyContent>
                  <Button onClick={onAdd}>
                    <PlusIcon />
                    {t('budget.add')}
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
          {view.sections.map((section) => (
            <BudgetSectionView
              key={section.kind}
              section={section}
              mainCurrencyCode={currencyCodes.get(mainCurrencyId ?? -1)}
              onSelectLine={onSelectLine}
              onSelectUnbudgeted={onSelectUnbudgeted}
            />
          ))}
          {view.missingCurrencyIds.length > 0 && (
            <Alert>
              <AlertDescription>
                {t('budget.missingRates', {
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

function BudgetSectionView({
  section,
  mainCurrencyCode,
  onSelectLine,
  onSelectUnbudgeted,
}: {
  section: BudgetSection;
  mainCurrencyCode: string | undefined;
  onSelectLine: (row: BudgetLineRow) => void;
  onSelectUnbudgeted: (category: Category) => void;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const money = (amount: string) => formatMoney(amount, mainCurrencyCode, i18n.language, { currencyDisplay: 'narrowSymbol' });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      {/* Stacked rather than side by side: a long total in a narrow window wraps under the name. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-2">
        <h2 id={headingId} className="text-sm font-medium text-muted-foreground">
          {t(`budget.sections.${section.kind}`)}
        </h2>
        {section.total && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('budget.sectionTotal', { done: money(section.total.recorded), amount: money(section.total.amount) })}
          </p>
        )}
      </div>
      <ul className="divide-y rounded-xl border">
        {section.lines.map((row) => (
          <li key={row.line.id}>
            <LineRow row={row} kind={section.kind} onSelect={() => onSelectLine(row)} />
          </li>
        ))}
        {section.unbudgeted && (
          <li>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              className="flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-2 text-left hover:bg-muted/50"
              onClick={() => setExpanded((current) => !current)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
                <ListIcon />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{t('budget.notInBudget')}</span>
              <span className="whitespace-nowrap tabular-nums">{money(section.unbudgeted.total)}</span>
              <ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded && (
              <ul id={listId} className="divide-y border-t">
                {section.unbudgeted.rows.map(({ key, category, total }) => {
                  const content = (
                    <>
                      {category ? (
                        <AppearanceIcon icon={category.icon} color={category.color} size="sm" />
                      ) : (
                        <AppearanceIcon placeholder="none" size="sm" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{category?.name ?? t('budget.noCategory')}</span>
                      <span className="text-sm whitespace-nowrap tabular-nums">{money(total)}</span>
                    </>
                  );
                  const layout = 'flex min-h-11 w-full min-w-0 items-center gap-3 py-2 pr-4 pl-[3.75rem] text-left';
                  return (
                    <li key={key}>
                      {category ? (
                        <button type="button" className={cn(layout, 'hover:bg-muted/50')} onClick={() => onSelectUnbudgeted(category)}>
                          {content}
                        </button>
                      ) : (
                        <div className={layout}>{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

function LineRow({ row, kind, onSelect }: { row: BudgetLineRow; kind: BudgetSectionKind; onSelect: () => void }) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const code = currencyCodes.get(row.line.currencyId);
  const money = (amount: string) => formatMoney(amount, code, i18n.language, { currencyDisplay: 'narrowSymbol' });
  const goal = kind === 'expense' ? 'limit' : 'target';
  const past = moneySign(row.remaining) < 0;
  const remaining = past ? negate(row.remaining) : row.remaining;
  const remainingText =
    goal === 'limit'
      ? t(past ? 'budget.over' : 'budget.left', { amount: money(remaining) })
      : t(past ? 'budget.beyond' : 'budget.toGo', { amount: money(remaining) });
  const remainingColor = past ? (goal === 'limit' ? MONEY_COLORS.negative : MONEY_COLORS.positive) : 'text-muted-foreground';
  const of = t('budget.of', { amount: money(row.amount) });
  const { icon, color } = row.target.type === 'category' ? row.target.category : row.target.account;

  return (
    <button type="button" className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={onSelect}>
      <AppearanceIcon icon={icon} color={color} fallbackIcon={row.target.type === 'account' ? 'wallet' : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate font-medium">{targetName(row.target)}</p>
          <p className="font-medium whitespace-nowrap tabular-nums">{money(row.recorded)}</p>
        </div>
        <BudgetBar
          amount={row.amount}
          recorded={row.recorded}
          planned={row.planned}
          goal={goal}
          label={`${targetName(row.target)}: ${money(row.recorded)} ${of}`}
        />
        <div className="flex items-start gap-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className={cn('truncate', remainingColor)}>{remainingText}</p>
            {moneySign(row.planned) > 0 && (
              <p className="truncate text-muted-foreground">{t('budget.planned', { amount: money(row.planned) })}</p>
            )}
          </div>
          <p className="whitespace-nowrap text-muted-foreground tabular-nums">{of}</p>
        </div>
      </div>
    </button>
  );
}
