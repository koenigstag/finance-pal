import { makeAutoObservable } from 'mobx';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Theme = 'light' | 'dark';

// Also read by the inline script in index.html, which applies the theme before first paint.
// Keep the key and the values in sync with it.
export const THEME_STORAGE_KEY = 'ft.theme';

export function parseThemePreference(value: string | null): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
}

/**
 * Light/dark choice. A per-device setting, like the OS one it defaults to: stored in the
 * browser, not on the profile. Applying it to the document is stores/effects.ts's job.
 */
export class ThemeStore {
  preference: ThemePreference = 'system';
  systemPrefersDark = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    this.preference = readStoredPreference();

    // Optional: jsdom (tests) has no matchMedia, and then "system" means light.
    const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (darkQuery) {
      this.systemPrefersDark = darkQuery.matches;
      // The OS switching between light and dark, e.g. on a schedule.
      darkQuery.addEventListener('change', (event) => this.setSystemPrefersDark(event.matches));
    }

    // A choice made in another tab.
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        this.setPreference(readStoredPreference(), { persist: false });
      }
    });
  }

  get theme(): Theme {
    if (this.preference === 'system') {
      return this.systemPrefersDark ? 'dark' : 'light';
    }
    return this.preference;
  }

  setPreference(preference: ThemePreference, { persist = true }: { persist?: boolean } = {}): void {
    this.preference = preference;
    if (persist) {
      writeStoredPreference(preference);
    }
  }

  setSystemPrefersDark(prefersDark: boolean): void {
    this.systemPrefersDark = prefersDark;
  }
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Still applies for this page load.
  }
}
