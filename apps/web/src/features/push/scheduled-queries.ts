import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferResponseBody } from '@ts-rest/core';
import type { scheduledNotificationsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type ScheduledNotification = ClientInferResponseBody<typeof scheduledNotificationsContract.list, 200>[number];

/** What a group has scheduled: still to come, and the past week's. */
export function useScheduledNotifications(groupId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scheduledNotifications(groupId),
    queryFn: () => unwrap(api.scheduledNotifications.list({ params: { groupId } }), 200),
    enabled,
  });
}

export function useScheduleNotification(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { text: string; sendAt: string; timezone: string }) =>
      unwrap(api.scheduledNotifications.create({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduledNotifications(groupId) }),
  });
}

/** Calls one off, or clears one that has already gone out. */
export function useDeleteScheduledNotification(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) =>
      unwrap(api.scheduledNotifications.remove({ params: { groupId, notificationId } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduledNotifications(groupId) }),
  });
}
