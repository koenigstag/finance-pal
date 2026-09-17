import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ru } from './locales/ru';

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

// The profile's language (set during onboarding, changed in settings) wins over the browser's.
// Null means "no signed-in profile": fall back to detection again, e.g. after logout.
let preferredLanguage: Language | null = null;

export function setPreferredLanguage(language: string | null): void {
  preferredLanguage = language !== null && isSupportedLanguage(language) ? language : null;
  const next = preferredLanguage ?? detectLanguage();
  if (i18n.language !== next) {
    void i18n.changeLanguage(next);
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  // React already escapes rendered text.
  interpolation: { escapeValue: false },
});

// Follow the browser if its language preference changes while the app is open, unless the
// profile has chosen one.
window.addEventListener('languagechange', () => {
  if (!preferredLanguage) {
    void i18n.changeLanguage(detectLanguage());
  }
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
