import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney, formatPercentage } from '@/lib/money';
import type { Transaction } from './queries';

type PercentageOf = Pick<Transaction, 'percentage' | 'percentageBase' | 'currencyId'>;

/**
 * What an amount worked out as a percentage was of: "5% of $12,000.50" for a base amount, and for
 * the balance "3% of the balance of Card" — or just "3% of the balance" where the account's name
 * shows already. Null for an amount that was simply typed.
 */
export function usePercentageLabel(): (transaction: PercentageOf, accountName?: string) => string | null {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  return useCallback(
    (transaction: PercentageOf, accountName?: string) => {
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
