import { LocaleStore } from './locale-store';
import { SessionStore } from './session-store';
import { ThemeStore } from './theme-store';

/**
 * Client-side state that isn't server data. API data (profile, groups, accounts, transactions…)
 * is TanStack Query's, not a store's: it's a cache of the server, with its own refetching and
 * invalidation.
 */
export class RootStore {
  readonly session = new SessionStore();
  readonly theme = new ThemeStore();
  readonly locale = new LocaleStore();
}

// One instance for the app. React code reaches it through useStores(); non-React code that has
// no component to hook into (the API client, token refresh) imports it directly.
export const rootStore = new RootStore();
