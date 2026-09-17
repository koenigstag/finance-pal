import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

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
