import { UserMinusIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defineAbilityFor, type AssignableMemberRole } from '@ft/shared-contracts';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';
import { useStores } from '@/stores/stores-context';
import { useInviteMember, useMembers, useRemoveMember, useUpdateMemberRole, type Group, type Member } from './queries';

const ASSIGNABLE_ROLES: AssignableMemberRole[] = ['admin', 'member', 'viewer'];

/**
 * Who is in the group and what they may do. Owners and admins can invite people who already have
 * an account, change roles and remove members; everyone else just sees the list.
 */
export const GroupMembers = observer(function GroupMembers({ group, open }: { group: Group; open: boolean }) {
  const { t } = useTranslation();
  const { session } = useStores();
  const members = useMembers(group.id, open);
  const removeMember = useRemoveMember(group.id);
  const [removing, setRemoving] = useState<Member | undefined>();

  const ability = defineAbilityFor({ role: group.role, archived: group.archivedAt !== null });
  const canManage = ability.can('manage', 'GroupMember');

  return (
    <div className="flex flex-1 flex-col gap-4">
      {canManage && <InviteMemberForm group={group} />}

      {members.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : members.isError ? (
        <QueryError onRetry={() => void members.refetch()} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {members.data.map((member) => (
            <li key={member.userId} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {member.email}
                  {member.userId === session.session?.user.id && ` · ${t('groups.members.you')}`}
                </p>
              </div>
              {/* The owner's role can't be handed over here: that moves ownership, a flow of its own. */}
              {canManage && member.role !== 'owner' ? (
                <MemberRoleSelect groupId={group.id} member={member} />
              ) : (
                <span className="text-sm text-muted-foreground">{t(`groups.roles.${member.role}`)}</span>
              )}
              {(canManage || member.userId === session.session?.user.id) && member.role !== 'owner' && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('groups.members.remove', { email: member.email })}
                  onClick={() => setRemoving(member)}
                >
                  <UserMinusIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!removing}
        onOpenChange={(next) => {
          if (!next && !removeMember.isPending) {
            setRemoving(undefined);
            removeMember.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('groups.members.removeConfirm.title', { email: removing?.email ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('groups.members.removeConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          {removeMember.isError && (
            <Alert variant="destructive">
              <AlertDescription>{t('errors.generic')}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMember.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removing) {
                  removeMember.mutate(removing.userId, { onSuccess: () => setRemoving(undefined) });
                }
              }}
            >
              {removeMember.isPending && <Spinner />}
              {t('groups.members.removeAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

function MemberRoleSelect({ groupId, member }: { groupId: string; member: Member }) {
  const { t } = useTranslation();
  const updateRole = useUpdateMemberRole(groupId);

  return (
    <Select
      value={member.role}
      disabled={updateRole.isPending}
      onValueChange={(role) => updateRole.mutate({ userId: member.userId, role: role as AssignableMemberRole })}
    >
      <SelectTrigger size="sm" aria-label={t('groups.members.role', { email: member.email })}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {t(`groups.roles.${role}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InviteMemberForm({ group }: { group: Group }) {
  const { t } = useTranslation();
  const invite = useInviteMember(group.id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableMemberRole>('member');

  const error = invite.error;
  const message =
    error instanceof ApiError && error.status === 404
      ? t('groups.members.errors.noUser')
      : error instanceof ApiError && error.status === 409
        ? t('groups.members.errors.alreadyMember')
        : error
          ? t('errors.generic')
          : undefined;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail('') });
      }}
    >
      <Field>
        <FieldLabel htmlFor="invite-email">{t('groups.members.invite')}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            placeholder={t('auth.email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select value={role} onValueChange={(value) => setRole(value as AssignableMemberRole)}>
            <SelectTrigger aria-label={t('groups.members.inviteRole')} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_ROLES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`groups.roles.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="outline" disabled={!email.trim() || invite.isPending}>
        {invite.isPending && <Spinner />}
        {t('groups.members.inviteAction')}
      </Button>
    </form>
  );
}
