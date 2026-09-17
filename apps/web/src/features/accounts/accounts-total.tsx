import { useTranslation } from 'react-i18next';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { useProfile } from '@/features/profile/queries';
import { formatMoney, moneySign, sumMoney } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { useAccounts } from './queries';

/**
 * The group's money at a glance: the balances of accounts counted in the total and held in the
 * user's main currency. Accounts in other currencies are left out rather than converted, since
 * there are no exchange rates to convert with.
 */
export function AccountsTotal({ groupId, className }: { groupId: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const accounts = useAccounts(groupId);
  const profile = useProfile();
  const currencyCodes = useCurrencyCodes();
  const currencyId = profile.data?.mainCurrencyId;

  if (!accounts.data || currencyId === undefined) {
    return null;
  }
  const total = sumMoney(
    accounts.data
      .filter((account) => account.isIncludedInBalance && account.currencyId === currencyId)
      .map((account) => account.balance),
  );

  return (
    <div className={cn('flex min-w-0 flex-col items-center leading-tight', className)}>
      <span className="truncate text-xs text-muted-foreground">{t('accounts.total')}</span>
      <span className={cn('truncate font-semibold tabular-nums', signColor(moneySign(total)))}>
        {formatMoney(total, currencyCodes.get(currencyId), i18n.language, { currencyDisplay: 'narrowSymbol' })}
      </span>
    </div>
  );
}
