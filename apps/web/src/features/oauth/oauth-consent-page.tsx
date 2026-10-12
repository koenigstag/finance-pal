import { EyeIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { ApiKeyResource } from '@ft/shared-contracts';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { readLastGroupId } from '@/features/groups/last-group';
import { useGroups, type Group } from '@/features/groups/queries';
import { ApiError } from '@/lib/api/client';
import { authorizationRequestOf, useApprove, useConsent } from './queries';

/**
 * Where an app asking to connect over OAuth, such as an AI assistant reaching the MCP endpoint,
 * sends the person: what it would see, in which group, and a yes or a no. Either answer sends the
 * browser back to the app. The app is named as it named itself, which proves nothing, so where it
 * would be sent back to is shown beside it.
 */
export function OauthConsentPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const request = useMemo(() => authorizationRequestOf(search), [search]);
  const consent = useConsent(request);
  const groups = useGroups();
  const approve = useApprove(request);
  const [picked, setPicked] = useState<string>();
  // Set once the browser is on its way back to the app, which can take a moment.
  const [leavingFor, setLeavingFor] = useState<string>();

  if (consent.isPending || groups.isPending) {
    return <FullPageSpinner />;
  }
  if (consent.isError) {
    return (
      <ConsentCard title={t('oauth.invalid.title')}>
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-1">
            <span>{t(isUnavailable(consent.error) ? 'oauth.invalid.unavailable' : 'oauth.invalid.description')}</span>
            {consent.error instanceof ApiError && consent.error.status === 400 && (
              <span className="text-xs">{consent.error.message}</span>
            )}
          </AlertDescription>
        </Alert>
      </ConsentCard>
    );
  }
  if (groups.isError) {
    return <QueryError onRetry={() => void groups.refetch()} />;
  }

  const { clientName, redirectHost, scopes, denyUrl } = consent.data;
  const groupId = picked ?? defaultGroupId(groups.data);
  const leave = (url: string) => {
    setLeavingFor(url);
    window.location.assign(url);
  };

  if (leavingFor) {
    return (
      <ConsentCard title={t('oauth.title', { name: clientName })}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t('oauth.returning', { host: redirectHost })}
        </p>
      </ConsentCard>
    );
  }

  return (
    <ConsentCard title={t('oauth.title', { name: clientName })} description={t('oauth.description', { name: clientName })}>
      <FieldGroup>
        {groups.data.length === 0 ? (
          <Alert>
            <AlertDescription className="flex flex-col gap-2">
              <span>{t('oauth.noGroups')}</span>
              <Link className="underline" to="/groups/new">
                {t('groups.create.title')}
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <Field>
            <FieldLabel htmlFor="oauth-group">{t('oauth.group')}</FieldLabel>
            <Select value={groupId} onValueChange={setPicked}>
              <SelectTrigger id="oauth-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.data.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t('oauth.canView')}</span>
          <ul className="flex flex-col gap-1.5">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-2">
                <EyeIcon className="size-4 text-muted-foreground" />
                {t(`oauth.resources.${scope.split(':')[0] as ApiKeyResource}`)}
              </li>
            ))}
          </ul>
          <span className="text-muted-foreground">{t('oauth.readOnly')}</span>
        </div>

        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>{t('oauth.redirect', { host: redirectHost })}</span>
          <span>{t('oauth.selfNamed')}</span>
          <span>{t('oauth.disconnect', { name: clientName })}</span>
        </div>

        {approve.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => leave(denyUrl)} disabled={approve.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => groupId && approve.mutate(groupId, { onSuccess: ({ redirectTo }) => leave(redirectTo) })}
            disabled={!groupId || approve.isPending}
          >
            {t('oauth.allow')}
          </Button>
        </div>
      </FieldGroup>
    </ConsentCard>
  );
}

function ConsentCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-svh items-start justify-center p-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:items-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description ?? t('app.name')}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}

// The group last opened, as "/" picks it; otherwise the first one still in use.
function defaultGroupId(groups: Group[]): string | undefined {
  const last = readLastGroupId();
  return groups.find((group) => group.id === last)?.id ?? groups.find((group) => !group.archivedAt)?.id ?? groups[0]?.id;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}
