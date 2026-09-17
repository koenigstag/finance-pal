import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssignableMemberRole } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export function useGroups() {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => unwrap(api.groups.list(), 200),
  });
}

export type Group = NonNullable<ReturnType<typeof useGroups>['data']>[number];

interface CreateGroupInput {
  name: string;
  // Starter accounts and categories. The MVP has no category management, so a group created
  // without them has nothing to categorize transactions with.
  seed: boolean;
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, seed }: CreateGroupInput) => {
      const group = await unwrap(api.groups.create({ body: { name } }), 201);
      if (seed) {
        // No language passed: the API seeds in the profile's language.
        await unwrap(api.groups.seed({ params: { groupId: group.id }, body: {} }), 201);
      }
      return group;
    },
    // Settled, not success: if seeding fails the group still exists and should be listed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

export function useRenameGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, name }: { groupId: string; name: string }) =>
      unwrap(api.groups.rename({ params: { groupId }, body: { name } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (groupId: string) => unwrap(api.groups.remove({ params: { groupId } }), 200),
    onSuccess: async (_, groupId) => {
      // Out of the list first: a page still showing the group then leaves it (GroupLayout
      // redirects away from a group it can't find) before its now-404ing queries could refetch.
      queryClient.setQueryData<Group[]>(queryKeys.groups, (groups) => groups?.filter((group) => group.id !== groupId));
      queryClient.removeQueries({ queryKey: queryKeys.group(groupId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

export function useMembers(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.members(groupId),
    queryFn: () => unwrap(api.groups.listMembers({ params: { groupId } }), 200),
    enabled,
  });
}

export type Member = NonNullable<ReturnType<typeof useMembers>['data']>[number];

export function useInviteMember(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { email: string; role: AssignableMemberRole }) =>
      unwrap(api.groups.inviteMember({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(groupId) }),
  });
}

export function useUpdateMemberRole(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableMemberRole }) =>
      unwrap(api.groups.updateMemberRole({ params: { groupId, userId }, body: { role } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(groupId) }),
  });
}

export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => unwrap(api.groups.removeMember({ params: { groupId, userId } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(groupId) }),
  });
}
