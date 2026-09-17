import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useRenameGroup, type Group } from './queries';

/** The group's own details. Only its name for now; the API has nothing else to change. */
export function GroupDetailsForm({ group, onDone }: { group: Group; onDone: () => void }) {
  const { t } = useTranslation();
  const rename = useRenameGroup();
  const [name, setName] = useState(group.name);
  const trimmed = name.trim();

  return (
    <form
      className="flex flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate({ groupId: group.id, name: trimmed }, { onSuccess: onDone });
      }}
    >
      <FieldGroup className="flex-1 gap-4">
        <Field>
          <FieldLabel htmlFor="group-name">{t('groups.create.name')}</FieldLabel>
          <Input id="group-name" value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </Field>
        {rename.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
      <Button type="submit" disabled={!trimmed || trimmed === group.name || rename.isPending}>
        {rename.isPending && <Spinner />}
        {t('common.save')}
      </Button>
    </form>
  );
}
