import { useQuery } from '@tanstack/react-query';
import type { ClientInferResponseBody } from '@ts-rest/core';
import type { overviewContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { deviceTimezone, monthRange, parseMonthParam } from '@/lib/dates';
import { queryKeys } from '@/lib/query-keys';

export type OverviewDays = ClientInferResponseBody<typeof overviewContract.days, 200>['days'];

/**
 * What was spent and received each day of a month, by its YYYY-MM: the month's bounds and its days
 * as this device's calendar has them, as the transactions list has them too.
 */
export function useOverviewDays(groupId: string, month: string) {
  return useQuery({
    queryKey: queryKeys.overviewDays(groupId, month),
    queryFn: () =>
      unwrap(
        api.overview.days({
          params: { groupId },
          query: { ...monthRange(parseMonthParam(month)), timezone: deviceTimezone() },
        }),
        200,
      ).then((body) => body.days),
  });
}
