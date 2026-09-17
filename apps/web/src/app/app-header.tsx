import { observer } from 'mobx-react-lite';
import { ChevronRightIcon, SettingsIcon, UserIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { HeaderToolsOutlet } from '@/components/header-tools';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AccountsTotal } from '@/features/accounts/accounts-total';
import { GroupSettingsSheet } from '@/features/groups/group-settings-sheet';
import { GroupsSheet } from '@/features/groups/groups-sheet';
import { useGroups, type Group } from '@/features/groups/queries';
import { useStores } from '@/stores/stores-context';

/**
 * Top bar for the signed-in app, with the group's total in the middle. On a phone the account
 * menu sits on the left, where a thumb reaches it, and the current page's own controls (e.g.
 * filters) on the right; from md up the app's name takes the left and both controls the right.
 * The account menu names the current group and opens a sheet to switch.
 */
export const AppHeader = observer(function AppHeader({ currentGroupId }: { currentGroupId?: string }) {
  const { t } = useTranslation();
  const { session } = useStores();
  const groups = useGroups();
  const current = groups.data?.find((group) => group.id === currentGroupId);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<Group | undefined>();

  // One menu per screen size rather than one moved around: each is its own trigger, and only
  // the one for the current width is rendered.
  const accountMenu = (className: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.account')} className={className}>
          <UserIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{session.session?.user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setGroupsOpen(true)}>
          <span className="min-w-0 flex-1 truncate">{current?.name ?? t('groups.switcher.placeholder')}</span>
          <ChevronRightIcon className="text-muted-foreground" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <SettingsIcon />
            {t('settings.title')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/80">
      {/* Equal side columns keep the total centered whatever the group name's length. */}
      <div className="mx-auto grid h-14 max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
        <div className="flex min-w-0 items-center">
          {accountMenu('-ml-2 md:hidden')}
          <Link to="/" className="hidden items-center gap-2 font-semibold md:inline-flex">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <WalletIcon className="size-4" />
            </span>
            <span className="truncate">{t('app.name')}</span>
          </Link>
        </div>

        {currentGroupId ? <AccountsTotal groupId={currentGroupId} /> : <span />}

        <div className="flex items-center gap-1 justify-self-end">
          <HeaderToolsOutlet className="flex items-center gap-1" />
          {accountMenu('hidden md:inline-flex')}
        </div>
      </div>

      <GroupsSheet
        currentGroupId={currentGroupId}
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        onOpenSettings={setSettingsGroup}
      />
      <GroupSettingsSheet
        // Kept after closing so the sheet keeps its content while it animates out.
        group={settingsGroup}
        open={!!settingsGroup}
        onOpenChange={(next) => !next && setSettingsGroup(undefined)}
      />
    </header>
  );
});
