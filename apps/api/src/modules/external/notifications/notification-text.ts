// What banks' notifications have in common, so each bank's parser reads them the same way.

// Besides the plain space: the no-break, narrow no-break, thin and figure spaces that banks and
// phones put between digit groups and around amounts.
const SPACES = /[\u00a0\u202f\u2009\u2007]/g;
// Besides the hyphen: the minus sign, and the dashes some apps print as one.
const MINUSES = /[\u2212\u2013\u2014]/g;

/** The text with every kind of space plain and every kind of minus a hyphen; line breaks stay. */
export function plainText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(SPACES, ' ').replace(MINUSES, '-');
}

/**
 * The lines that say something, trimmed, each once. An automation forwarding a notification's text
 * and its expanded text sends the same lines twice when the two are alike, which they often are.
 */
export function distinctLines(text: string): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set(lines)];
}

/**
 * For comparing words, not for showing them: lower case, with Latin i as Cyrillic і. Ukrainian
 * banks mix the two in one word ("Заробiтна", "Зi своєї картки" come with a Latin i), which no
 * reader notices and a plain comparison fails on.
 */
export function folded(text: string): string {
  return text.toLowerCase().replace(/i/g, 'і');
}

// An amount as banks print one: digits, grouped by spaces or not, and up to two decimals after a
// point or a comma. parseMoneyInput turns it into money.
export const AMOUNT = String.raw`\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

/** The ISO 4217 code of a currency as a notification prints it: "₴", "грн", "UAH", "HUF". */
export function currencyCode(printed: string): string | null {
  if (printed === '₴' || printed === 'грн' || printed === 'грн.') {
    return 'UAH';
  }
  return /^[A-Z]{3}$/.test(printed) ? printed : null;
}
