import { observer } from 'mobx-react-lite';
import { ChevronsUpDownIcon, LogOutIcon, PlusIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logout } from '@/features/auth/logout';
import { useGroups } from '@/features/groups/queries';
import { useStores } from '@/stores/stores-context';

/** Top bar for the signed-in app: group switcher on the left, account menu on the right. */
export const AppHeader = observer(function AppHeader({ currentGroupId }: { currentGroupId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useStores();
  const groups = useGroups();
  const current = groups.data?.find((group) => group.id === currentGroupId);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="max-w-64 justify-between gap-2">
              <span className="truncate">{current?.name ?? t('groups.switcher.placeholder')}</span>
              <ChevronsUpDownIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuLabel>{t('groups.switcher.label')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={currentGroupId} onValueChange={(groupId) => void navigate(`/g/${groupId}`)}>
              {groups.data?.map((group) => (
                <DropdownMenuRadioItem key={group.id} value={group.id}>
                  <span className="truncate">{group.name}</span>
                  {group.archivedAt && <span className="text-xs text-muted-foreground">{t('groups.archived')}</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/groups/new">
                <PlusIcon />
                {t('groups.create.title')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.account')}>
              <UserIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{session.session?.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <SettingsIcon />
                {t('settings.title')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOutIcon />
              {t('auth.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
});
