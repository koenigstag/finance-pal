/**
 * Uppercases only the first character. CSS `capitalize` would touch every word, turning Russian
 * "сентябрь 2026 г." into "Сентябрь 2026 Г.".
 */
export function capitalizeFirst(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
