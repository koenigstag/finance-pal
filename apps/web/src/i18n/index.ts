import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ru } from './locales/ru';

export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// The default UI language is the browser's; anything unsupported falls back to English. A manual
// choice made in settings, once that exists, should override this rather than replace it.
export function detectLanguage(): Language {
  const primary = navigator.language.slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(primary as Language) ? (primary as Language) : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  // React already escapes rendered text.
  interpolation: { escapeValue: false },
});

// Follow the browser if its language preference changes while the app is open.
window.addEventListener('languagechange', () => {
  void i18n.changeLanguage(detectLanguage());
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
