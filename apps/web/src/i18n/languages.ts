// Pure language helpers, kept apart from the i18next setup in ./index so stores and tests can use
// them without initializing i18next.

export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(language: string): language is Language {
  return SUPPORTED_LANGUAGES.includes(language as Language);
}

// Before there's a profile to read, the UI follows the browser; anything unsupported falls back
// to English.
export function detectLanguage(): Language {
  const primary = navigator.language.slice(0, 2).toLowerCase();
  return isSupportedLanguage(primary) ? primary : 'en';
}
