import { createContext, useContext } from 'react';
import type { AppAbility } from '@ft/shared-contracts';
import type { Group } from './queries';

export interface GroupScope {
  group: Group;
  // The same rules the API enforces, for hiding or disabling what the caller can't do here.
  ability: AppAbility;
}

export const GroupScopeContext = createContext<GroupScope | null>(null);

/** The group of the current /g/:groupId route. Only valid below GroupLayout. */
export function useGroupScope(): GroupScope {
  const scope = useContext(GroupScopeContext);
  if (!scope) {
    throw new Error('useGroupScope must be used inside GroupLayout');
  }
  return scope;
}
