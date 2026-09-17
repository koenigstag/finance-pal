import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStoreEffects } from './effects';
import { LocaleStore } from './locale-store';
import { RootStore } from './root-store';

const withBrowserLanguage = (language: string) => vi.stubGlobal('navigator', { ...navigator, language });

describe('LocaleStore', () => {
  beforeEach(() => {
    withBrowserLanguage('ru-RU');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the browser until a profile's language is set, and again after it is cleared", () => {
    const store = new LocaleStore();
    expect(store.language).toBe('ru');

    store.setProfileLanguage('en');
    expect(store.language).toBe('en');

    store.setProfileLanguage(null);
    expect(store.language).toBe('ru');
  });

  it('ignores a profile language the UI does not ship', () => {
    const store = new LocaleStore();
    store.setProfileLanguage('de');
    expect(store.language).toBe('ru');
  });

  it('tracks browser language changes, which the profile language still overrides', () => {
    const store = new LocaleStore();
    store.setProfileLanguage('ru');

    withBrowserLanguage('en-US');
    window.dispatchEvent(new Event('languagechange'));
    expect(store.browserLanguage).toBe('en');
    expect(store.language).toBe('ru');
  });

  it('switches i18next when the resolved language changes', async () => {
    await i18next.init({ lng: 'en', resources: { en: { translation: {} }, ru: { translation: {} } } });
    const stores = new RootStore();
    const stop = startStoreEffects(stores, i18next);
    expect(i18next.language).toBe('ru');

    stores.locale.setProfileLanguage('en');
    await vi.waitFor(() => expect(i18next.language).toBe('en'));
    stop();
  });
});
