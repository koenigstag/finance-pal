import {
  AlarmClockIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defineAbilityFor } from '@ft/shared-contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GroupApiKeys } from '@/features/api-keys/group-api-keys';
import { GroupCategoryRules } from '@/features/category-rules/group-category-rules';
import { GroupScheduledNotifications } from '@/features/push/group-scheduled-notifications';
import { cn } from '@/lib/utils';
import { DeleteGroupDialog } from './delete-group-dialog';
import { GroupDetailsForm } from './group-details-form';
import { GroupMembers } from './group-members';
import type { Group } from './queries';

type View = 'menu' | 'details' | 'members' | 'scheduled' | 'category-rules' | 'api-keys';

interface GroupSettingsSheetProps {
  group?: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Everything about one group in a single place, opened from the groups sheet: its details, its
 * members, your API keys for it, and deleting it. Full screen on phones, a dialog from sm up; the
 * sections open inside it rather than as separate pages, so closing always returns to where the
 * app was.
 */
export function GroupSettingsSheet({ group, open, onOpenChange }: GroupSettingsSheetProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('menu');
  const [deleting, setDeleting] = useState(false);

  // Every opening starts at the menu, and switching groups never lands in another group's section.
  useEffect(() => {
    if (open) {
      setView('menu');
    }
  }, [open, group?.id]);

  const ability = group ? defineAbilityFor({ role: group.role, archived: group.archivedAt !== null }) : undefined;
  const canEditDetails = !!ability?.can('update', 'Group');
  const canDelete = !!ability?.can('delete', 'Group');

  const actions: { view: View; label: string; icon: LucideIcon }[] = [];
  if (canEditDetails) {
    actions.push({ view: 'details', label: t('groups.settings.details'), icon: PencilIcon });
  }
  actions.push({ view: 'members', label: t('groups.settings.members'), icon: UsersIcon });
  // Everyone sees what the group has scheduled; only a member who may record money adds one.
  actions.push({ view: 'scheduled', label: t('groups.settings.scheduled'), icon: AlarmClockIcon });
  // Everyone sees how notifications are filed; only a member who may record money changes it.
  actions.push({ view: 'category-rules', label: t('groups.settings.categoryRules'), icon: WandSparklesIcon });
  // Every member may have keys; a viewer's only read.
  actions.push({ view: 'api-keys', label: t('groups.settings.apiKeys'), icon: KeyRoundIcon });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col max-sm:top-0 max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none max-sm:pt-[calc(1rem+env(safe-area-inset-top))]">
          {group && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 pr-8">
                  {view !== 'menu' && (
                    <Button variant="ghost" size="icon" className="-ml-2" aria-label={t('common.back')} onClick={() => setView('menu')}>
                      <ArrowLeftIcon />
                    </Button>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <DialogTitle className="truncate">
                      {view === 'menu' ? group.name : actions.find((action) => action.view === view)?.label}
                    </DialogTitle>
                    <DialogDescription className="truncate">
                      {view === 'menu' ? t(`groups.roles.${group.role}`) : group.name}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {view === 'menu' ? (
                <div className="flex flex-1 flex-col gap-4">
                  <ul className="-mx-2 flex flex-col">
                    {actions.map(({ view: target, label, icon: Icon }) => (
                      <li key={target}>
                        <button
                          type="button"
                          className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => setView(target)}
                        >
                          <span className="flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
                            <Icon />
                          </span>
                          <span className="flex-1 font-medium">{label}</span>
                          <ChevronRightIcon className="size-4 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {canDelete && (
                    <Button variant="outline" className={cn('mt-auto w-full text-destructive')} onClick={() => setDeleting(true)}>
                      <Trash2Icon />
                      {t('groups.settings.delete')}
                    </Button>
                  )}
                </div>
              ) : view === 'details' ? (
                <GroupDetailsForm group={group} onDone={() => setView('menu')} />
              ) : view === 'members' ? (
                <GroupMembers group={group} open={open} />
              ) : view === 'scheduled' ? (
                <GroupScheduledNotifications group={group} open={open} />
              ) : view === 'category-rules' ? (
                <GroupCategoryRules group={group} open={open} />
              ) : (
                <GroupApiKeys group={group} open={open} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {group && (
        <DeleteGroupDialog
          group={group}
          open={deleting}
          onOpenChange={setDeleting}
          // The group is gone: this sheet has nothing left to show.
          onDeleted={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
