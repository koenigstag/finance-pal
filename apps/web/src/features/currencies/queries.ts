import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ClientInferResponseBody } from '@ts-rest/core';
import type { exchangeRatesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import { useProfile } from '@/features/profile/queries';
import { conversionBetween, effectiveRates, type Conversion } from './rates';

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

/**
 * Every rate against the signed-in user's main currency: the provider's where it quotes one, their
 * own where it doesn't (see effectiveRates). `fetched` is the provider's answer as it came, for
 * saying where the rates are from; `baseCode` is the main currency they're all valued in.
 */
export function useRates() {
  const profile = useProfile();
  const currencyCodes = useCurrencyCodes();
  const fetched = useExchangeRates();
  const baseCode = currencyCodes.get(profile.data?.mainCurrencyId ?? -1);
  const manual = profile.data?.exchangeRates;

  const rates = useMemo(
    () => (baseCode ? effectiveRates(baseCode, fetched.data, manual) : {}),
    [baseCode, fetched.data, manual],
  );
  return { rates, fetched, baseCode };
}

/**
 * How the app converts from one currency to another, by their ids (see conversionBetween), or null
 * without a rate for the pair. The same function while the rates and currencies are unchanged, so a
 * form schema built on it isn't rebuilt on every render.
 */
export function useConversionLookup(): (fromCurrencyId: number, toCurrencyId: number) => Conversion | null {
  const { rates } = useRates();
  const currencies = useCurrencies();

  return useCallback(
    (fromCurrencyId: number, toCurrencyId: number) => {
      const codeOf = (id: number) => currencies.data?.find((currency) => currency.id === id)?.code;
      const from = codeOf(fromCurrencyId);
      const to = codeOf(toCurrencyId);
      return from && to ? conversionBetween(rates, from, to) : null;
    },
    [rates, currencies.data],
  );
}
