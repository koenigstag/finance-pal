import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { accountGroups, type Account } from '@/features/accounts/queries';
import { categoriesUnder, type Category } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney, moneySign } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import type { TransactionFormValues } from './transaction-form-model';
import { TRANSACTION_TYPE_ICONS, TRANSACTION_TYPE_ORDER } from './transaction-types';

type TransactionType = TransactionFormValues['type'];

export type KindPick =
  | { type: 'income' | 'expense'; categoryId: string }
  | { type: 'transfer'; toAccountId: string };

/**
 * The first step of a transaction: what kind it is, and what it's for. Income and expense list
 * their top-level categories — a subcategory is picked afterwards, from chips on the form; a
 * transfer lists the accounts it could go to, in a section per kind. A bottom sheet on phones,
 * a dialog from sm up.
 */
export function KindPicker({
  open,
  onOpenChange,
  title,
  type,
  lockedType,
  categories,
  accounts,
  fromAccountId,
  selected,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // The tab to open on.
  type: TransactionType;
  // Set when the type is already decided: the sheet names it instead of offering the others.
  lockedType?: TransactionType;
  categories: Category[];
  accounts: Account[];
  // A transfer can't go back to where it came from.
  fromAccountId?: string;
  // What's chosen now, to mark in the list: a category id ('' for none) or an account id.
  selected?: string;
  onPick: (pick: KindPick) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TransactionType>(lockedType ?? type);

  // Every opening starts on the tab asked for, not wherever the last visit left it.
  useEffect(() => {
    if (open) {
      setTab(lockedType ?? type);
    }
  }, [open, type, lockedType]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // With tabs, one size for all of them: the sheet mustn't jump as the lists change length.
        className={cn('flex max-h-[85svh] flex-col', !lockedType && 'h-[min(85svh,40rem)]')}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* With the type decided, the title says it ("Add expense") and there's nothing to switch. */}
        {!lockedType && (
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={tab}
            onValueChange={(value) => value && setTab(value as TransactionType)}
          >
            {TRANSACTION_TYPE_ORDER.map((option) => {
              const Icon = TRANSACTION_TYPE_ICONS[option];
              return (
                <ToggleGroupItem key={option} value={option} className="flex-1">
                  <Icon />
                  {t(`transactions.types.${option}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        )}

        <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable]">
          {tab === 'transfer' ? (
            <AccountOptions
              accounts={accounts.filter((account) => account.id !== fromAccountId)}
              selectedId={selected}
              onPick={(toAccountId) => onPick({ type: 'transfer', toAccountId })}
            />
          ) : (
            <ul>
              <PickerRow
                selected={selected === ''}
                onClick={() => onPick({ type: tab, categoryId: '' })}
                icon={<AppearanceIcon placeholder="none" />}
                label={t('transactions.noCategory')}
              />
              {categoriesUnder(categories, tab, null).map((category) => (
                <PickerRow
                  key={category.id}
                  selected={selected === category.id}
                  onClick={() => onPick({ type: tab, categoryId: category.id })}
                  icon={<AppearanceIcon icon={category.icon} color={category.color} />}
                  label={category.name}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Choosing one account for one side of a transaction: the account chosen now on top, the rest
 * below it in a section per kind. Its title says which side it's for.
 */
export function AccountPicker({
  open,
  onOpenChange,
  title,
  accounts,
  selectedId,
  excludeId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  accounts: Account[];
  selectedId?: string;
  // The other side of a transfer, which this one can't also be.
  excludeId?: string;
  onPick: (accountId: string) => void;
}) {
  const current = accounts.find((account) => account.id === selectedId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {current && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
            <AppearanceIcon icon={current.icon} color={current.color} fallbackIcon="wallet" size="lg" />
            <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
            <AccountBalance account={current} />
          </div>
        )}
        <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable]">
          <AccountOptions
            accounts={accounts.filter((account) => account.id !== excludeId)}
            selectedId={selectedId}
            onPick={onPick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The accounts to choose from, under a heading per kind. With everything falling under one there
 * is nothing to tell apart, so the heading is left off and the accounts stand on their own.
 */
function AccountOptions({
  accounts,
  selectedId,
  onPick,
}: {
  accounts: Account[];
  selectedId?: string;
  onPick: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const headings = useId();
  const groups = accountGroups(accounts);

  return groups.map(({ type, accounts: inGroup }) => (
    <section
      key={type}
      aria-labelledby={groups.length > 1 ? `${headings}-${type}` : undefined}
      className="flex flex-col gap-1"
    >
      {groups.length > 1 && (
        <h3 id={`${headings}-${type}`} className="px-2 text-sm font-medium text-muted-foreground">
          {t(`accounts.groups.${type}`)}
        </h3>
      )}
      <ul>
        {inGroup.map((account) => (
          <PickerRow
            key={account.id}
            selected={account.id === selectedId}
            onClick={() => onPick(account.id)}
            icon={<AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" />}
            label={account.name}
            aside={<AccountBalance account={account} />}
          />
        ))}
      </ul>
    </section>
  ));
}

export function AccountBalance({ account, className }: { account: Account; className?: string }) {
  const { i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  return (
    <span className={cn('text-sm whitespace-nowrap tabular-nums', signColor(moneySign(account.balance)), className)}>
      {formatMoney(account.balance, currencyCodes.get(account.currencyId), i18n.language, { currencyDisplay: 'narrowSymbol' })}
    </span>
  );
}

function PickerRow({
  icon,
  label,
  aside,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  aside?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {aside}
      </button>
    </li>
  );
}
