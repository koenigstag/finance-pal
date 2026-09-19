import { initClient, tsRestFetchApi, type ApiFetcher, type AppRouter, type InitClientArgs } from '@ts-rest/core';
import {
  accountsContract,
  apiKeysContract,
  authContract,
  categoriesContract,
  currenciesContract,
  exchangeRatesContract,
  groupsContract,
  onboardingContract,
  recurringRulesContract,
  transactionsContract,
} from '@ft/shared-contracts';
import { API_ORIGIN } from './api-url';
import { ApiError, toApiError } from './errors';
import { refreshSession } from './refresh';
import { rootStore } from '@/stores/root-store';

// The auth routes that run without a session. A 401 from one of them means bad credentials,
// not an expired token, so there is nothing to refresh. Changing a password is authenticated
// and therefore not among them — its 401 is an expired token like anywhere else, which is why
// a wrong current password answers 403.
const UNAUTHENTICATED_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

// Attaches the access token and, on a 401 from a protected route, refreshes once and retries once.
const authorizedFetch: ApiFetcher = async (args) => {
  const send = (accessToken: string | undefined) =>
    tsRestFetchApi({
      ...args,
      headers: accessToken ? { ...args.headers, authorization: `Bearer ${accessToken}` } : args.headers,
    });

  const session = rootStore.session.session;
  const response = await send(session?.accessToken);
  if (response.status !== 401 || !session || UNAUTHENTICATED_PATHS.some((path) => args.path.includes(path))) {
    return response;
  }

  const refreshed = await refreshSession(session.accessToken);
  return refreshed ? send(refreshed.accessToken) : response;
};

const clientArgs = {
  // Same origin in development (the Vite dev server proxies /api); a static deployment such as
  // GitHub Pages points this at wherever the API is hosted.
  baseUrl: API_ORIGIN,
  baseHeaders: {},
  api: authorizedFetch,
  validateResponse: false,
} satisfies InitClientArgs;

const clientFor = <T extends AppRouter>(contract: T) => initClient(contract, clientArgs);

export const api = {
  auth: clientFor(authContract),
  groups: clientFor(groupsContract),
  onboarding: clientFor(onboardingContract),
  currencies: clientFor(currenciesContract),
  exchangeRates: clientFor(exchangeRatesContract),
  accounts: clientFor(accountsContract),
  categories: clientFor(categoriesContract),
  transactions: clientFor(transactionsContract),
  recurringRules: clientFor(recurringRulesContract),
  apiKeys: clientFor(apiKeysContract),
};

type Response = { status: number; body: unknown };
type SuccessBody<R extends Response, S extends number> = Extract<R, { status: S }>['body'];

/**
 * Turns a ts-rest result into its success body, or throws an ApiError for any other status —
 * so query functions and mutations can use plain async/await and TanStack Query's error state.
 */
export async function unwrap<R extends Response, S extends R['status']>(
  request: Promise<R>,
  successStatus: S,
): Promise<SuccessBody<R, S>> {
  const response = await request;
  if (response.status !== successStatus) {
    throw toApiError(response.status, response.body);
  }
  return response.body as SuccessBody<R, S>;
}

export { ApiError };
