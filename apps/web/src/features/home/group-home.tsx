import { useTranslation } from 'react-i18next';
import { useGroupScope } from '@/features/groups/group-context';

// Stands in for the home screen until accounts and transactions land in the next step.
export function GroupHome() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();

  return (
    <section className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{group.name}</h1>
      <p className="text-muted-foreground">
        {t(`groups.roles.${group.role}`)}
        {ability.cannot('create', 'Transaction') && ` · ${t('groups.readOnly')}`}
      </p>
    </section>
  );
}
