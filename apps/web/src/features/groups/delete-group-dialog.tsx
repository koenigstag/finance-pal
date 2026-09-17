import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useDeleteGroup, type Group } from './queries';

interface DeleteGroupDialogProps {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

/**
 * Deleting a group takes everything in it with it, for every member, and nothing brings it back —
 * so it asks twice: once for what will be lost, then for the group's name, typed out.
 */
export function DeleteGroupDialog({ group, open, onOpenChange, onDeleted }: DeleteGroupDialogProps) {
  const { t } = useTranslation();
  const deleteGroup = useDeleteGroup();
  const [confirmed, setConfirmed] = useState(false);
  const [typedName, setTypedName] = useState('');

  // Both steps start over every time, so a second attempt can't inherit the first one's answers.
  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setTypedName('');
      deleteGroup.reset();
    }
    // The mutation object changes on every state of its own; only the opening matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const matches = typedName.trim() === group.name;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleteGroup.isPending) {
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('groups.delete.title', { name: group.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(confirmed ? 'groups.delete.confirmName' : 'groups.delete.description')}
          </AlertDialogDescription>
          {/* Said again, in red, right where the name is typed: the last chance to stop. */}
          {confirmed && <p className="text-sm font-medium text-destructive">{t('groups.delete.irreversible')}</p>}
        </AlertDialogHeader>

        {confirmed && (
          <Field>
            <FieldLabel htmlFor="delete-group-name">{t('groups.delete.nameLabel', { name: group.name })}</FieldLabel>
            <Input
              id="delete-group-name"
              autoComplete="off"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
            />
          </Field>
        )}
        {deleteGroup.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteGroup.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmed && (!matches || deleteGroup.isPending)}
            onClick={(event) => {
              // Neither step closes the dialog by itself: the first moves on to the name, the
              // second stays open until the request settles.
              event.preventDefault();
              if (!confirmed) {
                setConfirmed(true);
                return;
              }
              if (matches) {
                deleteGroup.mutate(group.id, {
                  onSuccess: () => {
                    onOpenChange(false);
                    onDeleted();
                  },
                });
              }
            }}
          >
            {deleteGroup.isPending && <Spinner />}
            {t(confirmed ? 'groups.delete.submit' : 'groups.delete.continue')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
