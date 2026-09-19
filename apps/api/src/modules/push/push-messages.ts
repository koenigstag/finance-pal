import { TRANSACTION_TYPES, type PushPayload, type PushTopic } from '@ft/shared-contracts';

type TransactionKind = (typeof TRANSACTION_TYPES)[number];

/**
 * Everything the app can notify someone about, as data rather than text: what happened, never how
 * it reads. The wording is chosen per recipient, below, because two people in one group may well
 * read the app in different languages.
 */
export type PushMessage =
  | {
      kind: 'transaction.recorded';
      groupId: string;
      groupName: string;
      // Whoever recorded it, as they call themselves; null when they haven't set a name.
      actor: string | null;
      type: TransactionKind;
      amount: string;
      currency: string;
    }
  | { kind: 'member.added'; groupId: string; groupName: string; actor: string | null }
  | { kind: 'planned.recorded'; groupId: string; groupName: string; type: TransactionKind; amount: string; currency: string }
  // Somebody's own note, scheduled for this moment. Its text is theirs, not the catalogue's.
  | { kind: 'scheduled.due'; id: string; groupId: string; groupName: string; text: string }
  | { kind: 'push.test' };

/**
 * Which switch in settings a message answers to, and so which devices it reaches. The test
 * notification answers to none: it goes to every device its own owner has registered, which is
 * the whole point of it — checking that notifications arrive at all.
 */
export function topicFor(message: PushMessage): PushTopic | null {
  switch (message.kind) {
    case 'transaction.recorded':
      return 'transactions';
    case 'member.added':
      return 'members';
    case 'planned.recorded':
      return 'planned';
    case 'scheduled.due':
      return 'scheduled';
    case 'push.test':
      return null;
  }
}

// Languages the API can write a notification in. Anything else a profile holds falls back to
// English rather than showing a key or an empty line.
const LANGUAGES = ['en', 'ru'] as const;
type Language = (typeof LANGUAGES)[number];

interface PushStrings {
  // What to call someone who hasn't set a display name.
  someone: string;
  recorded: Record<TransactionKind, (actor: string, amount: string) => string>;
  planned: Record<TransactionKind, (amount: string) => string>;
  memberAdded: (actor: string) => string;
  test: { title: string; body: string };
}

// English is the shape the others are checked against, as in the web app's catalog: a phrase
// added here and forgotten there fails the build instead of going out untranslated.
const STRINGS: Record<Language, PushStrings> = {
  en: {
    someone: 'Someone',
    recorded: {
      expense: (actor, amount) => `${actor} spent ${amount}`,
      income: (actor, amount) => `${actor} received ${amount}`,
      transfer: (actor, amount) => `${actor} moved ${amount}`,
    },
    planned: {
      expense: (amount) => `A planned expense of ${amount} was recorded`,
      income: (amount) => `A planned income of ${amount} was recorded`,
      transfer: (amount) => `A planned transfer of ${amount} was recorded`,
    },
    memberAdded: (actor) => `${actor} added you to this group`,
    test: { title: 'Finance Pal', body: 'Notifications are working on this device.' },
  },
  ru: {
    someone: 'Кто-то',
    recorded: {
      expense: (actor, amount) => `${actor} потратил(а) ${amount}`,
      income: (actor, amount) => `${actor} получил(а) ${amount}`,
      transfer: (actor, amount) => `${actor} перевёл(а) ${amount}`,
    },
    planned: {
      expense: (amount) => `Запланированный расход ${amount} добавлен`,
      income: (amount) => `Запланированный доход ${amount} добавлен`,
      transfer: (amount) => `Запланированный перевод ${amount} добавлен`,
    },
    memberAdded: (actor) => `${actor} добавил(а) вас в эту группу`,
    test: { title: 'Finance Pal', body: 'Уведомления на этом устройстве работают.' },
  },
};

function stringsFor(language: string): { strings: PushStrings; language: Language } {
  // "ru-RU" and "ru" are the same catalog here; the profile stores the short form, but a browser
  // detection that slipped through would otherwise land on English.
  const short = language.split('-')[0].toLowerCase();
  const match = LANGUAGES.find((known) => known === short);
  return { strings: STRINGS[match ?? 'en'], language: match ?? 'en' };
}

/**
 * An amount the way the recipient reads amounts: their locale's grouping and decimal marks, and
 * the currency's own symbol where the platform knows it. Falls back to "1234.50 UAH" for a code
 * Intl doesn't recognise rather than letting a notification fail over its formatting.
 */
export function formatAmount(amount: string, currency: string, language: Language): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return `${amount} ${currency}`;
  }
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * The message as one device will see it: a title, a line of text, where tapping it goes, and the
 * tag that lets a later notification about the same group take its place.
 *
 * The group's name is the title throughout, not the app's: on a phone that shows one line, "which
 * budget" is what tells someone whether to look now, and the app's name is already beside it.
 */
export function renderPushMessage(message: PushMessage, language: string): PushPayload {
  const { strings, language: resolved } = stringsFor(language);

  switch (message.kind) {
    case 'transaction.recorded':
      return {
        title: message.groupName,
        body: strings.recorded[message.type](
          message.actor ?? strings.someone,
          formatAmount(message.amount, message.currency, resolved),
        ),
        path: `g/${message.groupId}/transactions`,
        tag: `transactions:${message.groupId}`,
      };
    case 'planned.recorded':
      return {
        title: message.groupName,
        body: strings.planned[message.type](formatAmount(message.amount, message.currency, resolved)),
        path: `g/${message.groupId}/transactions`,
        tag: `planned:${message.groupId}`,
      };
    case 'member.added':
      return {
        title: message.groupName,
        body: strings.memberAdded(message.actor ?? strings.someone),
        path: `g/${message.groupId}`,
        tag: `members:${message.groupId}`,
      };
    case 'scheduled.due':
      return {
        title: message.groupName,
        // Written by a person, in whatever language they wrote it: there is nothing to translate,
        // and translating it would put words in their mouth.
        body: message.text,
        path: `g/${message.groupId}`,
        // Its own tag, unlike the others: two notes due at the same moment are two things to
        // read, not one taking the other's place.
        tag: `scheduled:${message.id}`,
      };
    case 'push.test':
      // No path: it opens the app wherever it was left, since there is nothing new to look at.
      return { ...strings.test, tag: 'test' };
  }
}
