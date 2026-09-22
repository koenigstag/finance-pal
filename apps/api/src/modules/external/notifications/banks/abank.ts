import { isPositiveMoney, parseMoneyInput } from '@ft/shared-contracts';
import { AMOUNT, currencyCode, distinctLines, folded, plainText } from '../notification-text';
import type { NotificationParser } from '../parsed-notification';

// A-Bank's notifications, as its app (àbank24) posts them in 2026. The title is the money; the
// text says what it was, then what's left:
//
//   🛒 -133.40 ₴           title: a category emoji (not always), the signed amount, the currency
//   АТБ                    who the money went to or came from
//   Кешбек: 1.6 ₴          sometimes
//   Баланс: 55 757.11 ₴    on every payment
//
// A purchase abroad has its own currency in the title ("🍸 -4 280.00 HUF") and the rate in the
// text; it's read as it is, in that currency, and the account's currency decides what happens.

// The title's line: an optional emoji, then the signed amount and its currency, and nothing else.
const TITLE = new RegExp(String.raw`^(?:\S+ )?([+-]) ?(${AMOUNT}) ?(₴|грн|UAH|[A-Z]{3})$`);
const BALANCE = new RegExp(String.raw`Баланс: ?-?(?:${AMOUNT})`);
// The labelled figures that follow a name on its line, when the text comes as a single line:
// "АТБ Кешбек: 1.6 ₴ Баланс: 55 757.11 ₴". The labels may carry a Latin i as well.
const FIGURES = /(?:^|\s+)(?:Кешбек|Баланс|Ком[iі]с[iі]я|Кредитн[iі] кошти|Курс)(?=[\s:]|$).*$/;

// Money moved between the account holder's own cards. They are one account in the app, so the
// pair of notifications a move posts (one card's minus, the other's plus) records nothing.
const OWN_CARDS = ['на свою картку', 'зі своєї картки'];
const DECLINED = /відмов|відхилен|недостатньо коштів/;

export const parseABankNotification: NotificationParser = (raw) => {
  const lines = distinctLines(plainText(raw));
  const titleIndex = lines.findIndex((line) => TITLE.test(line));
  if (titleIndex === -1) {
    return null;
  }
  const [, sign, printedAmount, printedCurrency] = TITLE.exec(lines[titleIndex]) as RegExpExecArray;
  const text = lines.filter((_, index) => index !== titleIndex);

  // Every payment says what's left after it. A notification that doesn't isn't one of those this
  // knows, however much it looks like one: better a 422 that gets it looked at than a guess.
  if (!text.some((line) => BALANCE.test(line))) {
    return null;
  }
  if (DECLINED.test(folded(text.join('\n')))) {
    return { kind: 'skip', reason: 'A declined payment' };
  }

  const counterparty = nameIn(text);
  if (counterparty !== null && OWN_CARDS.includes(folded(counterparty))) {
    return { kind: 'skip', reason: 'A move between your own cards' };
  }

  const amount = parseMoneyInput(printedAmount);
  const currency = currencyCode(printedCurrency);
  if (amount === null || currency === null || !isPositiveMoney(amount)) {
    return null;
  }
  return { kind: 'movement', type: sign === '-' ? 'expense' : 'income', amount, currency, counterparty };
};

// The first thing the text says that isn't a labelled figure: the shop, the person, "Заробiтна плата".
function nameIn(text: string[]): string | null {
  for (const line of text) {
    const name = line.replace(FIGURES, '').trim();
    if (name) {
      return name;
    }
  }
  return null;
}
