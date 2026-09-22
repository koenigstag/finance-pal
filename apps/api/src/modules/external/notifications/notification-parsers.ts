import type { NotificationBank } from '@ft/shared-contracts';
import { parseABankNotification } from './banks/abank';
import type { NotificationParser } from './parsed-notification';

// A record over the contract's list of banks, so a bank added there without a parser fails the
// build here instead of reaching a request.
export const NOTIFICATION_PARSERS: Record<NotificationBank, NotificationParser> = {
  abank: parseABankNotification,
};
