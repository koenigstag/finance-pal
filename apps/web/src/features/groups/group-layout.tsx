import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useParams } from 'react-router';
import { defineAbilityFor } from '@ft/shared-contracts';
import { AppHeader } from '@/app/app-header';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { HeaderToolsProvider } from '@/components/header-tools';
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
      <HeaderToolsProvider>
      {/*
        A screen-high column: header and tabs stay put and the content area below scrolls. A page
        can instead fill that area and scroll just a part of itself (flex-1 min-h-0 on its root and
        the part), as the transactions page does with its list.
      */}
      <div className="flex h-svh flex-col">
        <AppHeader currentGroupId={group.id} />
        <TopNav groupId={group.id} />
        {/*
          Full width so its scrollbar sits at the window's edge; the horizontal padding centers the
          content in a max-w-5xl column. The bottom padding on phones clears the fixed tab bar;
          pages add their own room for the floating action button (PAGE_BOTTOM_SPACE).
        */}
        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[max(1rem,calc((100%-64rem)/2+1rem))] pt-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {archived && (
            <Alert className="shrink-0">
              <AlertDescription>{t('groups.archivedNotice')}</AlertDescription>
            </Alert>
          )}
          <Outlet />
        </main>
      </div>
      <BottomNav groupId={group.id} />
      </HeaderToolsProvider>
    </GroupScopeContext.Provider>
  );
}
