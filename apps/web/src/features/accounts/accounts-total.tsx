import { useTranslation } from 'react-i18next';
import { useCurrencyCodes, useRates } from '@/features/currencies/queries';
import { useProfile } from '@/features/profile/queries';
import { convertMoney, formatMoney, moneySign, sumMoney } from '@/lib/money';
import { signColor } from '@/lib/money-colors';
import { cn } from '@/lib/utils';
import { useAccounts } from './queries';

/**
 * The group's money at a glance: the balances of accounts counted in the total, in the user's main
 * currency — the others converted at the rates fetched, or the user's own for a currency no
 * provider quotes (see effectiveRates).
 *
 * Missing a rate for any of them, it's the accounts in the main currency alone, as before there were
 * rates: a sum that quietly left some accounts out would read as the whole.
 */
export function AccountsTotal({ groupId, className }: { groupId: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const accounts = useAccounts(groupId);
  const profile = useProfile();
  const currencyCodes = useCurrencyCodes();
  const { rates } = useRates();
  const currencyId = profile.data?.mainCurrencyId;

  if (!accounts.data || currencyId === undefined) {
    return null;
  }
  const counted = accounts.data.filter((account) => account.isIncludedInBalance);
  const rateOf = (id: number) => {
    const code = currencyCodes.get(id);
    return code ? rates[code]?.rate : undefined;
  };
  const total = counted.every((account) => rateOf(account.currencyId))
    ? sumMoney(counted.map((account) => convertMoney(account.balance, rateOf(account.currencyId) ?? '1')))
    : sumMoney(counted.filter((account) => account.currencyId === currencyId).map((account) => account.balance));

  return (
    <div className={cn('flex min-w-0 flex-col items-center leading-tight', className)}>
      <span className="truncate text-xs text-muted-foreground">{t('accounts.total')}</span>
      <span className={cn('truncate font-semibold tabular-nums', signColor(moneySign(total)))}>
        {formatMoney(total, currencyCodes.get(currencyId), i18n.language, { currencyDisplay: 'narrowSymbol' })}
      </span>
    </div>
  );
}
