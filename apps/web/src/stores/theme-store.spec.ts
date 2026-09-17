import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStoreEffects } from './effects';
import { RootStore } from './root-store';
import { parseThemePreference, THEME_STORAGE_KEY, ThemeStore } from './theme-store';

// jsdom has no matchMedia; a fake lets tests play the OS switching themes.
let systemDark = false;
let emitSystemChange: (dark: boolean) => void = () => undefined;

describe('ThemeStore', () => {
  beforeEach(() => {
    systemDark = false;
    localStorage.clear();
    document.documentElement.className = '';
    vi.stubGlobal('matchMedia', () => ({
      matches: systemDark,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
        emitSystemChange = (dark) => listener({ matches: dark });
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats a missing or unknown stored value as system', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('follows the system by default, including later changes', () => {
    systemDark = true;
    const store = new ThemeStore();
    expect(store.theme).toBe('dark');

    emitSystemChange(false);
    expect(store.theme).toBe('light');
  });

  it('stores an explicit choice and ignores the system while it is set', () => {
    const store = new ThemeStore();
    store.setPreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    emitSystemChange(false);
    expect(store.theme).toBe('dark');
  });

  it('forgets the stored choice when going back to system', () => {
    const store = new ThemeStore();
    store.setPreference('light');
    store.setPreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('picks up a stored choice on creation', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(new ThemeStore().preference).toBe('dark');
  });

  it('applies the resolved theme to the document', () => {
    const stores = new RootStore();
    const stop = startStoreEffects(stores, i18next);

    stores.theme.setPreference('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    stores.theme.setPreference('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    stop();
  });
});
