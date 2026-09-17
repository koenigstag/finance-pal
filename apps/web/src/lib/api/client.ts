import { initClient, tsRestFetchApi, type ApiFetcher, type AppRouter, type InitClientArgs } from '@ts-rest/core';
import {
  accountsContract,
  authContract,
  categoriesContract,
  currenciesContract,
  groupsContract,
  onboardingContract,
  recurringRulesContract,
  transactionsContract,
} from '@ft/shared-contracts';
import { ApiError, toApiError } from './errors';
import { refreshSession } from './refresh';
import { tokenStore } from './token-store';

// Attaches the access token and, on a 401 from a protected route, refreshes once and retries
// once. Auth routes are exempt: a 401 from login means bad credentials, not an expired token.
const authorizedFetch: ApiFetcher = async (args) => {
  const send = (accessToken: string | undefined) =>
    tsRestFetchApi({
      ...args,
      headers: accessToken ? { ...args.headers, authorization: `Bearer ${accessToken}` } : args.headers,
    });

  const session = tokenStore.get();
  const response = await send(session?.accessToken);
  if (response.status !== 401 || !session || args.path.includes('/api/auth/')) {
    return response;
  }

  const refreshed = await refreshSession(session.accessToken);
  return refreshed ? send(refreshed.accessToken) : response;
};

const clientArgs = {
  // Same origin: the Vite dev server proxies /api to the API, and production serves both
  // behind one host.
  baseUrl: '',
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
  accounts: clientFor(accountsContract),
  categories: clientFor(categoriesContract),
  transactions: clientFor(transactionsContract),
  recurringRules: clientFor(recurringRulesContract),
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
