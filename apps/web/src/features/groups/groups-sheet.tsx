import { CheckIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGroups, type Group } from './queries';

interface GroupsSheetProps {
  currentGroupId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Opens that group's settings; the sheet closes first, so only one is ever on screen.
  onOpenSettings: (group: Group) => void;
}

/**
 * Switching groups on a phone: every group the caller belongs to, the current one checked, and a
 * way to add another. A bottom sheet on phones (the dialog's small-screen layout), a dialog from sm up.
 */
export function GroupsSheet({ currentGroupId, open, onOpenChange, onOpenSettings }: GroupsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = useGroups();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('groups.switcher.label')}</DialogTitle>
        </DialogHeader>
        <ul className="-mx-2 flex flex-col">
          {groups.data?.map((group) => {
            const current = group.id === currentGroupId;
            return (
              <li key={group.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={current || undefined}
                  className="flex min-h-12 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => {
                    onOpenChange(false);
                    if (!current) {
                      void navigate(`/g/${group.id}`);
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  {group.archivedAt && <span className="text-xs text-muted-foreground">{t('groups.archived')}</span>}
                  {current && <CheckIcon className="size-4 text-primary" />}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('groups.settings.open', { name: group.name })}
                  onClick={() => {
                    onOpenChange(false);
                    onOpenSettings(group);
                  }}
                >
                  <SettingsIcon />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button variant="outline" asChild>
          <Link to="/groups/new" onClick={() => onOpenChange(false)}>
            <PlusIcon />
            {t('groups.create.add')}
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
