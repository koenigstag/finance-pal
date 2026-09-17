import { makeAutoObservable } from 'mobx';
import { detectLanguage, isSupportedLanguage, type Language } from '@/i18n/languages';

/**
 * Which language the UI is in. The profile's language (set during onboarding, changed in
 * settings) wins over the browser's; without a signed-in profile the browser's applies.
 */
export class LocaleStore {
  browserLanguage: Language = detectLanguage();
  profileLanguage: Language | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });

    // The browser's language preference changing while the app is open.
    window.addEventListener('languagechange', () => this.setBrowserLanguage(detectLanguage()));
  }

  get language(): Language {
    return this.profileLanguage ?? this.browserLanguage;
  }

  /** Null (or a language the UI doesn't ship) hands the choice back to the browser. */
  setProfileLanguage(language: string | null): void {
    this.profileLanguage = language !== null && isSupportedLanguage(language) ? language : null;
  }

  setBrowserLanguage(language: Language): void {
    this.browserLanguage = language;
  }
}
