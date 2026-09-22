// What a bank's notification says about money, read from its text: only what the bank printed.
// Which account and category that goes to is decided afterwards, from the group's own settings.

export interface NotificationMovement {
  kind: 'movement';
  type: 'expense' | 'income';
  // As parseMoneyInput leaves it ("1250.50"), in `currency`.
  amount: string;
  // ISO 4217 ("UAH"); null when the text names none.
  currency: string | null;
  // Who the money went to or came from, as the bank printed it: a shop, a person. Null when the
  // text names nobody, as for a top-up.
  counterparty: string | null;
}

// Something a bank tells about that moves no money: a code, an ad, a declined payment.
export interface NotificationSkip {
  kind: 'skip';
  reason: string;
}

export type ParsedNotification = NotificationMovement | NotificationSkip;

// Null for text that isn't worded like anything the bank is known to send: reading it anyway would
// be a guess, and a guess about money is worse than asking.
export type NotificationParser = (text: string) => ParsedNotification | null;
