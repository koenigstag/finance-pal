const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * A starting point for the name field, guessed from the email's local part: "john.doe+bank" →
 * "John Doe". Only a suggestion the user can overwrite; empty when there's nothing usable.
 */
export function displayNameFromEmail(email: string | undefined, locale: string): string {
  const localPart = (email ?? '').split('@')[0] ?? '';
  const words = localPart
    // Sub-addressing ("+bank") names the inbox, not the person.
    .replace(/\+.*$/, '')
    .split(/[._\-\s]+/)
    // Digits are usually a disambiguator ("anna1987"), not part of the name.
    .map((word) => word.replace(/\d+/g, ''))
    .filter(Boolean);
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase(locale) + word.slice(1))
    .join(' ')
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
}
