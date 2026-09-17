import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { defineAbilityFor } from '@ft/shared-contracts';
import { AppHeader } from '@/app/app-header';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { GroupScopeContext } from './group-context';
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
      <GroupNav groupId={group.id} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        {archived && (
          <Alert>
            <AlertDescription>{t('groups.archivedNotice')}</AlertDescription>
          </Alert>
        )}
        <Outlet />
      </main>
    </GroupScopeContext.Provider>
  );
}

function GroupNav({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const links = [
    { to: `/g/${groupId}`, label: t('nav.home'), end: true },
    { to: `/g/${groupId}/accounts`, label: t('nav.accounts'), end: false },
    { to: `/g/${groupId}/transactions`, label: t('nav.transactions'), end: false },
  ];

  return (
    <nav className="border-b">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
