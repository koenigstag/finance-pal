import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
