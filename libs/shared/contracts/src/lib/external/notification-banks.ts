import { z } from 'zod';

// Banks whose notifications the external API can read (POST /notifications), by the id a
// request gives as its `type`. An account says which of them it receives, so a forwarded
// notification needs no account of its own. A bank joins this list together with its parser.
export const NOTIFICATION_BANKS = ['abank'] as const;
export type NotificationBank = (typeof NOTIFICATION_BANKS)[number];

export const notificationBankSchema = z.enum(NOTIFICATION_BANKS);

// As the banks write their own names, in every language.
export const NOTIFICATION_BANK_NAMES: Record<NotificationBank, string> = {
  abank: 'A-Bank',
};
