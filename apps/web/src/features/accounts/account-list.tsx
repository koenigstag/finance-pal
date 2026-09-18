import { ACCOUNT_TYPES } from '@ft/shared-contracts';
import { StarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney, moneySign } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import type { Account } from './queries';

// Section order: everyday money first, then what's put aside; debts follow, split by who owes whom.
const GROUP_ORDER = ['regular', 'savings'] as const satisfies readonly (typeof ACCOUNT_TYPES)[number][];

// A debt account's balance says who owes whom: below zero the debt is yours, above it someone owes
// you, and at zero it is settled — still worth keeping, but it has nothing to do with today.
const debtsWhere = (accounts: Account[], sign: -1 | 0 | 1) =>
  accounts.filter((account) => account.type === 'debt' && moneySign(account.balance) === sign);

interface AccountListProps {
  accounts: Account[];
  // Tapping a row: the accounts page opens that account's actions.
  onSelect: (account: Account) => void;
}

/**
 * Accounts with their balances, in a section per account type; empty sections are left out.
 * Debts come as three: what you owe, what you're owed, and what's settled.
 */
export function AccountList({ accounts, onSelect }: AccountListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      {GROUP_ORDER.map((type) => (
        <AccountSection
          key={type}
          id={`accounts-${type}`}
          heading={t(`accounts.groups.${type}`)}
          accounts={accounts.filter((account) => account.type === type)}
          onSelect={onSelect}
        />
      ))}
      <AccountSection id="accounts-owe" heading={t('accounts.groups.owe')} accounts={debtsWhere(accounts, -1)} onSelect={onSelect} />
      <AccountSection id="accounts-owed" heading={t('accounts.groups.owed')} accounts={debtsWhere(accounts, 1)} onSelect={onSelect} />
      <AccountSection
        id="accounts-settled"
        heading={t('accounts.groups.settled')}
        accounts={debtsWhere(accounts, 0)}
        onSelect={onSelect}
      />
    </div>
  );
}

interface AccountSectionProps {
  id: string;
  heading: string;
  accounts: Account[];
  onSelect: (account: Account) => void;
}

function AccountSection({ id, heading, accounts, onSelect }: AccountSectionProps) {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="px-1 text-sm font-medium text-muted-foreground">
        {heading}
      </h2>
      <AccountRows accounts={accounts} onSelect={onSelect} />
    </section>
  );
}

/** The rows on their own, for a caller that brings its own heading. */
export function AccountRows({ accounts, onSelect }: { accounts: Account[]; onSelect: (account: Account) => void }) {
  return (
    <ul className="divide-y rounded-xl border">
      {accounts.map((account) => (
        <li key={account.id}>
          <AccountRow account={account} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function AccountRow({ account, onSelect }: { account: Account; onSelect: (account: Account) => void }) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  // Symbols rather than codes (₴, not UAH): shorter, and the list is about the amounts.
  const balance = formatMoney(account.balance, currencyCodes.get(account.currencyId), i18n.language, {
    currencyDisplay: 'narrowSymbol',
  });

  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50"
      onClick={() => onSelect(account)}
    >
      <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" />
      <p className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
        <span className="truncate">{account.name}</span>
        {/* Just a marker: favourites are set in the account's sheet. */}
        {account.isFavourite && (
          <StarIcon className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={t('accounts.favourite')} />
        )}
      </p>
      <p className={cn('text-right font-medium tabular-nums', signColor(moneySign(account.balance)))}>{balance}</p>
    </button>
  );
}
