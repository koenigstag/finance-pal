import { useQuery } from '@tanstack/react-query';
import type { ClientInferResponseBody } from '@ts-rest/core';
import type { exchangeRatesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type ExchangeRates = ClientInferResponseBody<typeof exchangeRatesContract.get, 200>;

export function useCurrencies() {
  return useQuery({
    queryKey: queryKeys.currencies,
    queryFn: () => unwrap(api.currencies.list(), 200),
    // Reference data that only changes with a migration.
    staleTime: Infinity,
  });
}

/** Currency code by id, for formatting amounts; empty until the list has loaded. */
export function useCurrencyCodes(): Map<number, string> {
  const { data } = useCurrencies();
  return new Map(data?.map((currency) => [currency.id, currency.code]));
}

/**
 * Rates against the signed-in user's main currency, fetched by the API from a rate provider and
 * cached there for half a day. Errors are left to the caller: a total that spans currencies has
 * nothing honest to show without them, which is a different thing from showing zero.
 */
export function useExchangeRates() {
  return useQuery({
    queryKey: queryKeys.exchangeRates,
    queryFn: () => unwrap(api.exchangeRates.get(), 200),
    // The API refreshes twice a day at most, so asking again within the hour only costs a request.
    staleTime: 60 * 60 * 1000,
  });
}
