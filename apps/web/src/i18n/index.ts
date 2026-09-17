import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectLanguage } from './languages';
import { en } from './locales/en';
import { ru } from './locales/ru';

export { SUPPORTED_LANGUAGES, detectLanguage, isSupportedLanguage, type Language } from './languages';

// Which language is active is LocaleStore's decision (see stores/effects.ts); this only sets up
// the catalogs and a sensible first value before the stores take over.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  // React already escapes rendered text.
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
