import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Account } from './queries';

interface AccountListProps {
  accounts: Account[];
  // Tapping a row: the accounts page opens that account's actions.
  onSelect: (account: Account) => void;
}

/** Accounts with their balances. */
export function AccountList({ accounts, onSelect }: AccountListProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();

  return (
    <ul className="divide-y rounded-xl border">
      {accounts.map((account) => {
        const currency = currencyCodes.get(account.currencyId);
        // Symbols rather than codes (₴, not UAH): shorter, and the list is about the amounts.
        const format = (amount: string) => formatMoney(amount, currency, i18n.language, { currencyDisplay: 'narrowSymbol' });
        const hasPlanned = account.plannedBalance !== account.balance;
        return (
          <li key={account.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
              onClick={() => onSelect(account)}
            >
              <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{account.name}</p>
                <p className="text-sm text-muted-foreground">{t(`accounts.types.${account.type}`)}</p>
              </div>
              <div className="text-right">
                <p className={cn('font-medium tabular-nums', account.balance.startsWith('-') && 'text-destructive')}>
                  {format(account.balance)}
                </p>
                {hasPlanned && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {t('accounts.planned', { amount: format(account.plannedBalance) })}
                  </p>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
