import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest } from '@ts-rest/core';
import type { apiKeysContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export function useApiKeys(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.apiKeys(groupId),
    queryFn: () => unwrap(api.apiKeys.list({ params: { groupId } }), 200),
    enabled,
  });
}

export type ApiKey = NonNullable<ReturnType<typeof useApiKeys>['data']>[number];

type CreateBody = ClientInferRequest<typeof apiKeysContract.create>['body'];
type UpdateBody = ClientInferRequest<typeof apiKeysContract.update>['body'];

/** Resolves with the key itself as well, which only this response ever carries. */
export function useCreateApiKey(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateBody) => unwrap(api.apiKeys.create({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(groupId) }),
  });
}

export function useUpdateApiKey(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ apiKeyId, body }: { apiKeyId: string; body: UpdateBody }) =>
      unwrap(api.apiKeys.update({ params: { groupId, apiKeyId }, body }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(groupId) }),
  });
}

export function useDeleteApiKey(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (apiKeyId: string) => unwrap(api.apiKeys.remove({ params: { groupId, apiKeyId } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(groupId) }),
  });
}
