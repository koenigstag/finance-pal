import { UnprocessableEntityException } from '@nestjs/common';
import { NOTIFICATION_BANK_NAMES, type NotificationBank } from '@ft/shared-contracts';

export interface ReceivingAccountLike {
  id: string;
  archived: boolean;
  currencyId: number;
  notificationBank: string | null;
}

/**
 * The account a bank's notification is recorded on: the one set to receive that bank's
 * notifications. A bank with accounts in several currencies, a UAH card and a USD one, has one
 * receiving each, told apart by the currency the notification names. Anything less certain is
 * refused rather than picked: money recorded on the wrong account looks right until the balances
 * don't match.
 */
export function receivingAccount<T extends ReceivingAccountLike>(
  accounts: readonly T[],
  bank: NotificationBank,
  currency: string | null,
  currencyCodeOf: (currencyId: number) => string,
): T {
  const bankName = NOTIFICATION_BANK_NAMES[bank];
  const receiving = accounts.filter((account) => account.notificationBank === bank && !account.archived);
  if (receiving.length === 0) {
    throw new UnprocessableEntityException(
      `No account receives ${bankName} notifications: choose one in the app, in that account's settings`,
    );
  }

  const inCurrency =
    currency === null ? receiving : receiving.filter((account) => currencyCodeOf(account.currencyId) === currency);
  if (inCurrency.length === 1) {
    return inCurrency[0];
  }
  if (inCurrency.length === 0) {
    throw new UnprocessableEntityException(
      `The notification is in ${currency}, and no account receiving ${bankName} notifications is`,
    );
  }
  throw new UnprocessableEntityException(
    currency === null
      ? `${inCurrency.length} accounts receive ${bankName} notifications, and this one names no currency to tell them apart`
      : `${inCurrency.length} accounts in ${currency} receive ${bankName} notifications; keep the setting on one of them`,
  );
}
