import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney, formatPercentage } from '@/lib/money';
import type { Transaction } from './queries';

type AmountSource = Pick<Transaction, 'percentage' | 'percentageBase' | 'roundBalanceTo' | 'currencyId'>;

/**
 * What an amount that wasn't typed was worked out from: "5% of $12,000.50" for a base amount; for
 * the balance, "3% of the balance of Card" or "Rounds the balance of Card to 100" — or, where the
 * account's name shows already, just "3% of the balance", "Rounds the balance to 100". Null for an
 * amount that was simply typed.
 */
export function useAmountSourceLabel(): (transaction: AmountSource, accountName?: string) => string | null {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  return useCallback(
    (transaction: AmountSource, accountName?: string) => {
      if (transaction.roundBalanceTo) {
        const step = new Intl.NumberFormat(i18n.language).format(transaction.roundBalanceTo);
        return accountName === undefined
          ? t('transactions.roundsItsBalance', { step })
          : t('transactions.roundsBalanceOf', { step, account: accountName });
      }
      if (!transaction.percentage) {
        return null;
      }
      const percentage = formatPercentage(transaction.percentage, i18n.language);
      if (transaction.percentageBase) {
        // In the account's currency, which is the transaction's.
        const base = formatMoney(transaction.percentageBase, currencyCodes.get(transaction.currencyId), i18n.language, {
          currencyDisplay: 'narrowSymbol',
        });
        return t('transactions.percentageOfBase', { percentage, base });
      }
      return accountName === undefined
        ? t('transactions.percentageOfItsBalance', { percentage })
        : t('transactions.percentageOfBalance', { percentage, account: accountName });
    },
    [t, i18n.language, currencyCodes],
  );
}
