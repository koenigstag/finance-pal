import type { i18n as I18n } from 'i18next';
import { autorun, reaction } from 'mobx';
import type { RootStore } from './root-store';

/**
 * Pushes store state out to the browser: the theme onto the document, the language into
 * i18next. Kept out of the stores themselves so they stay plain state that tests can drive.
 * Returns a disposer.
 */
export function startStoreEffects(stores: RootStore, i18n: I18n): () => void {
  const disposers = [
    autorun(() => {
      const theme = stores.theme.theme;
      const root = document.documentElement;
      root.classList.toggle('dark', theme === 'dark');
      // Native controls (date pickers, scrollbars) follow this rather than the class.
      root.style.colorScheme = theme;
    }),
    reaction(
      () => stores.locale.language,
      (language) => {
        if (i18n.language !== language) {
          void i18n.changeLanguage(language);
        }
      },
      { fireImmediately: true },
    ),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
