import { CheckIcon, CopyIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_KEY_ACCESS_LEVELS,
  API_KEY_RESOURCES,
  API_KEY_SCOPES,
  apiKeyScope,
  canGrantApiKeyScope,
  defineAbilityFor,
  type ApiKeyScope,
  type AppAbility,
} from '@ft/shared-contracts';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAccounts } from '@/features/accounts/queries';
import type { Group } from '@/features/groups/queries';
import { API_ORIGIN } from '@/lib/api/api-url';
import { cn } from '@/lib/utils';
import {
  EXPIRY_OPTIONS,
  accessByResource,
  exampleRequest,
  expiresAtFor,
  externalApiBaseUrl,
  withScope,
  type ExpiryOption,
} from './api-key-access';
import { useApiKeys, useCreateApiKey, useDeleteApiKey, useUpdateApiKey, type ApiKey } from './queries';

type Mode = { view: 'list' } | { view: 'create' } | { view: 'edit'; apiKey: ApiKey } | { view: 'created'; token: string };

// A new key starts with adding transactions: all a phone automation logging payments needs.
const DEFAULT_SCOPES: ApiKeyScope[] = ['transactions:create'];

/**
 * Your own keys for other apps in this group, and making new ones. Nobody sees anyone else's keys
 * here, the group's owner included: a key is personal, it acts as the member who made it.
 */
export function GroupApiKeys({ group, open }: { group: Group; open: boolean }) {
  const { t } = useTranslation();
  const apiKeys = useApiKeys(group.id, open);
  const [mode, setMode] = useState<Mode>({ view: 'list' });
  const [deleting, setDeleting] = useState<ApiKey | undefined>();
  const ability = defineAbilityFor({ role: group.role, archived: group.archivedAt !== null });
  const toList = () => setMode({ view: 'list' });

  if (mode.view === 'create' || mode.view === 'edit') {
    return (
      <ApiKeyForm
        group={group}
        ability={ability}
        apiKey={mode.view === 'edit' ? mode.apiKey : undefined}
        onCancel={toList}
        onSaved={toList}
        onCreated={(token) => setMode({ view: 'created', token })}
      />
    );
  }
  if (mode.view === 'created') {
    return <NewApiKey group={group} token={mode.token} onDone={toList} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('apiKeys.description')}</p>
      <Button variant="outline" onClick={() => setMode({ view: 'create' })}>
        <PlusIcon />
        {t('apiKeys.create')}
      </Button>

      {apiKeys.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : apiKeys.isError ? (
        <QueryError onRetry={() => void apiKeys.refetch()} />
      ) : apiKeys.data.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{t('apiKeys.empty')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {apiKeys.data.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              onEdit={() => setMode({ view: 'edit', apiKey })}
              onDelete={() => setDeleting(apiKey)}
            />
          ))}
        </ul>
      )}

      <DeleteApiKeyDialog groupId={group.id} apiKey={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}

function ApiKeyRow({ apiKey, onEdit, onDelete }: { apiKey: ApiKey; onEdit: () => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const format = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const expired = apiKey.expiresAt !== null && new Date(apiKey.expiresAt) <= new Date();

  return (
    <li className="flex items-start gap-1 py-2 pr-1 pl-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{apiKey.name}</p>
        {/* Only the start of the key is kept, to tell keys apart. */}
        <p className="truncate font-mono text-xs text-muted-foreground">{apiKey.tokenPrefix}…</p>
        <div className="my-1.5 flex flex-wrap gap-1">
          {accessByResource(apiKey.scopes).map(({ resource, access }) => (
            <Badge key={resource} variant="secondary">
              {t('apiKeys.summary', {
                resource: t(`apiKeys.resources.${resource}`),
                levels: access.map((level) => t(`apiKeys.levels.${level}`)).join(', '),
              })}
            </Badge>
          ))}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {apiKey.lastUsedAt ? t('apiKeys.lastUsed', { date: format(apiKey.lastUsedAt) }) : t('apiKeys.neverUsed')}
        </p>
        {apiKey.expiresAt && (
          <p className={cn('truncate text-xs', expired ? 'text-destructive' : 'text-muted-foreground')}>
            {t(expired ? 'apiKeys.expiredOn' : 'apiKeys.expiresOn', { date: format(apiKey.expiresAt) })}
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon" aria-label={t('apiKeys.edit', { name: apiKey.name })} onClick={onEdit}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('apiKeys.remove', { name: apiKey.name })} onClick={onDelete}>
        <Trash2Icon />
      </Button>
    </li>
  );
}

interface ApiKeyFormProps {
  group: Group;
  ability: AppAbility;
  // Set when editing: the name and the access change, the key itself stays.
  apiKey?: ApiKey;
  onCancel: () => void;
  onSaved: () => void;
  onCreated: (token: string) => void;
}

function ApiKeyForm({ group, ability, apiKey, onCancel, onSaved, onCreated }: ApiKeyFormProps) {
  const { t } = useTranslation();
  const create = useCreateApiKey(group.id);
  const update = useUpdateApiKey(group.id);
  const [name, setName] = useState(apiKey?.name ?? '');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(
    apiKey?.scopes ?? DEFAULT_SCOPES.filter((scope) => canGrantApiKeyScope(ability, scope)),
  );
  const [expiry, setExpiry] = useState<ExpiryOption>('never');
  const mutation = apiKey ? update : create;
  const trimmed = name.trim();
  // A viewer's keys, and every key in an archived group, can only view.
  const readOnly = !API_KEY_SCOPES.some((scope) => !scope.endsWith(':read') && canGrantApiKeyScope(ability, scope));

  return (
    <form
      className="flex flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (apiKey) {
          update.mutate({ apiKeyId: apiKey.id, body: { name: trimmed, scopes } }, { onSuccess: onSaved });
        } else {
          create.mutate(
            { name: trimmed, scopes, expiresAt: expiresAtFor(expiry) },
            { onSuccess: ({ token }) => onCreated(token) },
          );
        }
      }}
    >
      <FieldGroup className="flex-1 gap-5">
        <Field>
          <FieldLabel htmlFor="api-key-name">{t('apiKeys.name')}</FieldLabel>
          <Input
            id="api-key-name"
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder={t('apiKeys.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <FieldSet className="gap-2">
          <FieldLegend variant="label">{t('apiKeys.access')}</FieldLegend>
          <AccessGrid ability={ability} scopes={scopes} onChange={setScopes} />
          {readOnly && (
            <FieldDescription>{t(group.archivedAt ? 'apiKeys.archivedGroup' : 'apiKeys.readOnlyRole')}</FieldDescription>
          )}
        </FieldSet>

        {!apiKey && (
          <Field>
            <FieldLabel htmlFor="api-key-expiry">{t('apiKeys.expiry')}</FieldLabel>
            <Select value={expiry} onValueChange={(value) => setExpiry(value as ExpiryOption)}>
              <SelectTrigger id="api-key-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`apiKeys.expiryOptions.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="flex-1" disabled={!trimmed || scopes.length === 0 || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {apiKey ? t('common.save') : t('apiKeys.submitCreate')}
        </Button>
      </div>
    </form>
  );
}

// One row per resource, one column per kind of access. What the role can't grant stays off.
function AccessGrid({
  ability,
  scopes,
  onChange,
}: {
  ability: AppAbility;
  scopes: ApiKeyScope[];
  onChange: (scopes: ApiKeyScope[]) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.75rem)] items-center gap-y-3 text-sm">
      <span />
      {API_KEY_ACCESS_LEVELS.map((level) => (
        <span key={level} className="text-center text-xs text-muted-foreground">
          {t(`apiKeys.columns.${level}`)}
        </span>
      ))}
      {API_KEY_RESOURCES.map((resource) => (
        <Fragment key={resource}>
          <span className="truncate">{t(`apiKeys.resources.${resource}`)}</span>
          {API_KEY_ACCESS_LEVELS.map((level) => {
            const scope = apiKeyScope(resource, level);
            return (
              <div key={level} className="flex justify-center">
                <Checkbox
                  checked={scopes.includes(scope)}
                  disabled={!canGrantApiKeyScope(ability, scope)}
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

// The only time the key itself is shown: the API keeps just a hash of it.
function NewApiKey({ group, token, onDone }: { group: Group; token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts(group.id);
  const baseUrl = externalApiBaseUrl(API_ORIGIN, window.location.origin);
  // A real account name makes the example work as pasted.
  const account = accounts.data?.find((candidate) => candidate.isFavourite) ?? accounts.data?.[0];
  const example = exampleRequest(baseUrl, token, account?.name ?? 'Card');

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Alert>
        <TriangleAlertIcon />
        <AlertDescription>{t('apiKeys.created.warning')}</AlertDescription>
      </Alert>
      <CopyField label={t('apiKeys.created.key')} value={token} />
      <CopyField label={t('apiKeys.created.baseUrl')} value={baseUrl} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('apiKeys.created.example')}</span>
          <CopyButton value={example} />
        </div>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{example}</pre>
        <p className="text-xs text-muted-foreground">{t('apiKeys.created.hint')}</p>
      </div>
      <Button className="mt-auto" onClick={onDone}>
        {t('apiKeys.created.done')}
      </Button>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={t(copied ? 'apiKeys.copied' : 'apiKeys.copy')}
      // Without clipboard access (an insecure origin) the text is still there to select.
      onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function DeleteApiKeyDialog({ groupId, apiKey, onClose }: { groupId: string; apiKey?: ApiKey; onClose: () => void }) {
  const { t } = useTranslation();
  const remove = useDeleteApiKey(groupId);

  return (
    <AlertDialog
      open={!!apiKey}
      onOpenChange={(next) => {
        if (!next && !remove.isPending) {
          onClose();
          remove.reset();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('apiKeys.deleteConfirm.title', { name: apiKey?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('apiKeys.deleteConfirm.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (apiKey) {
                remove.mutate(apiKey.id, { onSuccess: onClose });
              }
            }}
          >
            {remove.isPending && <Spinner />}
            {t('apiKeys.deleteConfirm.action')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
