import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useParams } from 'react-router';
import { defineAbilityFor } from '@ft/shared-contracts';
import { AppHeader } from '@/app/app-header';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GroupScopeContext } from './group-context';
import { BottomNav, TopNav } from './group-nav';
import { writeLastGroupId } from './last-group';
import { useGroups, type Group } from './queries';

/** Everything under /g/:groupId: resolves the group from the URL and provides it with its ability. */
export function GroupLayout() {
  const { groupId } = useParams();
  const groups = useGroups();

  if (groups.isPending) {
    return <FullPageSpinner />;
  }
  if (groups.isError) {
    return <QueryError onRetry={() => void groups.refetch()} />;
  }

  const group = groups.data.find((candidate) => candidate.id === groupId);
  if (!group) {
    // A stale link, or a group the caller has left or been removed from.
    return <Navigate to="/" replace />;
  }
  return <GroupScopeProvider key={group.id} group={group} />;
}

function GroupScopeProvider({ group }: { group: Group }) {
  const { t } = useTranslation();
  const archived = group.archivedAt !== null;
  const scope = useMemo(
    () => ({ group, ability: defineAbilityFor({ role: group.role, archived }) }),
    [group, archived],
  );

  useEffect(() => {
    writeLastGroupId(group.id);
  }, [group.id]);

  return (
    <GroupScopeContext.Provider value={scope}>
      <AppHeader currentGroupId={group.id} />
      <TopNav groupId={group.id} />
      {/* Bottom padding on phones clears the fixed tab bar and a floating action button. */}
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4 pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-8">
        {archived && (
          <Alert>
            <AlertDescription>{t('groups.archivedNotice')}</AlertDescription>
          </Alert>
        )}
        <Outlet />
      </main>
      <BottomNav groupId={group.id} />
    </GroupScopeContext.Provider>
  );
}
