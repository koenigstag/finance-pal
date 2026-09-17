import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Account } from '@/features/accounts/queries';
import { categoryOptions, type Category } from '@/features/categories/queries';
import { TRANSACTION_TYPE_ORDER } from './transaction-types';

type TransactionType = (typeof TRANSACTION_TYPES)[number];

// Select items can't have an empty value; this one means "no filter".
const ALL = 'all';
const SEARCH_DEBOUNCE_MS = 300;

export interface TransactionFilterValues {
  search: string;
  accountId?: string;
  type?: TransactionType;
  categoryId?: string;
}

interface TransactionFiltersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: TransactionFilterValues;
  // Applied to the list as they're made; the sheet has no "apply" step of its own.
  onChange: (patch: Partial<TransactionFilterValues>) => void;
  onReset: () => void;
  accounts: Account[];
  categories: Category[];
}

/**
 * Search and filters for the transactions list: full screen on phones, a dialog from sm up.
 * Changes apply to the list behind it right away, so Done just closes it.
 */
export function TransactionFiltersSheet({
  open,
  onOpenChange,
  values,
  onChange,
  onReset,
  accounts,
  categories,
}: TransactionFiltersSheetProps) {
  const { t } = useTranslation();
  const { search, accountId, type, categoryId } = values;
  const categoryFilterOptions = useMemo(
    () =>
      type === 'transfer'
        ? []
        : (type ? [type] : (['income', 'expense'] as const)).flatMap((categoryType) =>
            categoryOptions(categories, categoryType),
          ),
    [categories, type],
  );
  const hasFilters = Boolean(search || accountId || type || categoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-sm:top-0 max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none max-sm:pt-[calc(1rem+env(safe-area-inset-top))]">
        <DialogHeader>
          <DialogTitle>{t('transactions.filters.title')}</DialogTitle>
        </DialogHeader>
        <FieldGroup className="flex-1 gap-4">
          <Field>
            <FieldLabel htmlFor="filter-search">{t('transactions.filters.search')}</FieldLabel>
            <SearchInput id="filter-search" value={search} onChange={(value) => onChange({ search: value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-account">{t('transactions.account')}</FieldLabel>
            <Select value={accountId ?? ALL} onValueChange={(value) => onChange({ accountId: value === ALL ? undefined : value })}>
              <SelectTrigger id="filter-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('transactions.filters.allAccounts')}</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" size="sm" />
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-type">{t('transactions.filters.type')}</FieldLabel>
            <Select
              value={type ?? ALL}
              // A category belongs to one type; keeping it across a type change could only filter
              // everything out.
              onValueChange={(value) =>
                onChange({ type: value === ALL ? undefined : (value as TransactionType), categoryId: undefined })
              }
            >
              <SelectTrigger id="filter-type" className="w-full">
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
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-category">{t('transactions.category')}</FieldLabel>
            <Select
              value={categoryId ?? ALL}
              onValueChange={(value) => onChange({ categoryId: value === ALL ? undefined : value })}
              disabled={type === 'transfer'}
            >
              <SelectTrigger id="filter-category" className="w-full">
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
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!hasFilters} onClick={onReset}>
            {t('transactions.filters.reset')}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('transactions.filters.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Typing updates the field at once but the URL (and so the query) only after a pause.
function SearchInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow outside changes, e.g. a reset or back navigation — but not our own echo, which would
  // eat a trailing space mid-typing ("coffee " → "coffee").
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
      id={id}
      type="search"
      placeholder={t('transactions.filters.searchPlaceholder')}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}
