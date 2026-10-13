import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_KEY_ACCESS_LEVELS,
  API_KEY_RESOURCES,
  apiKeyScope,
  canGrantApiKeyScope,
  type ApiKeyScope,
  type AppAbility,
} from '@ft/shared-contracts';
import { Checkbox } from '@/components/ui/checkbox';
import { withScope } from './api-key-access';

interface AccessGridProps {
  ability: AppAbility;
  scopes: ApiKeyScope[];
  onChange: (scopes: ApiKeyScope[]) => void;
  // Shown ticked and fixed: what comes with the key whatever else is ticked.
  locked?: readonly ApiKeyScope[];
  // The only ones offered, where not every scope is; the rest stay off the grid.
  offered?: readonly ApiKeyScope[];
}

/**
 * What a key may do: one row per resource, one column per kind of access. What the owner's role
 * can't grant stays off. Resources with nothing offered are left out.
 */
export function AccessGrid({ ability, scopes, onChange, locked = [], offered }: AccessGridProps) {
  const { t } = useTranslation();
  const shown = (scope: ApiKeyScope) => locked.includes(scope) || !offered || offered.includes(scope);
  const resources = API_KEY_RESOURCES.filter((resource) =>
    API_KEY_ACCESS_LEVELS.some((level) => {
      const scope = apiKeyScope(resource, level);
      return scope !== null && shown(scope);
    }),
  );

  return (
    // The columns as wide as their headings, which run long in Russian ("Добавление"), and the
    // resource names in what's left.
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(3rem,auto))] items-center gap-x-1.5 gap-y-3 text-sm">
      <span />
      {API_KEY_ACCESS_LEVELS.map((level) => (
        <span key={level} className="text-center text-xs text-muted-foreground">
          {t(`apiKeys.columns.${level}`)}
        </span>
      ))}
      {resources.map((resource) => (
        <Fragment key={resource}>
          <span className="truncate">{t(`apiKeys.resources.${resource}`)}</span>
          {API_KEY_ACCESS_LEVELS.map((level) => {
            const scope = apiKeyScope(resource, level);
            if (!scope || !shown(scope)) {
              return <span key={level} />;
            }
            const isLocked = locked.includes(scope);
            return (
              <div key={level} className="flex justify-center">
                <Checkbox
                  checked={isLocked || scopes.includes(scope)}
                  disabled={isLocked || !canGrantApiKeyScope(ability, scope)}
                  aria-label={t('apiKeys.scope', {
                    resource: t(`apiKeys.resources.${resource}`),
                    level: t(`apiKeys.levels.${level}`),
                  })}
                  onCheckedChange={(checked) => onChange(withScope(scopes, scope, checked === true))}
                />
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
