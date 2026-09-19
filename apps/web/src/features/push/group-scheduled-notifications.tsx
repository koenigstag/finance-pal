import { BellRingIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defineAbilityFor } from '@ft/shared-contracts';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { Group } from '@/features/groups/queries';
import { deviceTimezone } from '@/lib/dates';
import { defaultSchedule, formatScheduledAt, toInstant } from './scheduled';
import {
  useDeleteScheduledNotification,
  useScheduleNotification,
  useScheduledNotifications,
  type ScheduledNotification,
} from './scheduled-queries';

/**
 * Notes this group has scheduled, and adding one: a sentence and a moment, which reaches everyone
 * in the group as a notification when the moment comes.
 *
 * The date and the time are read in this device's own zone and the zone travels with them, so a
 * note picked for 09:00 arrives at 09:00 where it was picked, and reads as 09:00 here afterwards
 * however far the reader has since travelled.
 */
export function GroupScheduledNotifications({ group, open }: { group: Group; open: boolean }) {
  const { t, i18n } = useTranslation();
  const scheduled = useScheduledNotifications(group.id, open);
  const create = useScheduleNotification(group.id);
  const remove = useDeleteScheduledNotification(group.id);

  const [text, setText] = useState('');
  const [{ date, time }, setWhen] = useState(() => defaultSchedule(new Date()));

  const ability = defineAbilityFor({ role: group.role, archived: group.archivedAt !== null });
  const canSchedule = ability.can('create', 'ScheduledNotification');
  const sendAt = toInstant(date, time);
  // A moment that has passed would go out on the scheduler's next minute, which nobody means by
  // picking a date; the API refuses it too, this only saves the round trip.
  const inThePast = sendAt !== null && new Date(sendAt) <= new Date();
  const ready = canSchedule && text.trim().length > 0 && sendAt !== null && !inThePast;

  const submit = () => {
    if (!ready || !sendAt) {
      return;
    }
    create.mutate(
      { text: text.trim(), sendAt, timezone: deviceTimezone() },
      {
        onSuccess: () => {
          setText('');
          setWhen(defaultSchedule(new Date()));
        },
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('scheduled.description')}</p>

      {canSchedule ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="scheduled-text">{t('scheduled.text')}</FieldLabel>
            <Input
              id="scheduled-text"
              value={text}
              maxLength={200}
              placeholder={t('scheduled.textPlaceholder')}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="scheduled-date">{t('scheduled.date')}</FieldLabel>
              <Input
                id="scheduled-date"
                type="date"
                value={date}
                onChange={(event) => setWhen((when) => ({ ...when, date: event.target.value }))}
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="scheduled-time">{t('scheduled.time')}</FieldLabel>
              <Input
                id="scheduled-time"
                type="time"
                value={time}
                onChange={(event) => setWhen((when) => ({ ...when, time: event.target.value }))}
              />
            </Field>
          </div>
          {inThePast && <p className="text-sm text-destructive">{t('scheduled.pastMoment')}</p>}
          <Button onClick={submit} disabled={!ready || create.isPending}>
            {create.isPending ? <Spinner /> : <PlusIcon />}
            {t('scheduled.schedule')}
          </Button>
        </FieldGroup>
      ) : (
        <p className="text-sm text-muted-foreground">
          {group.archivedAt !== null ? t('scheduled.archivedGroup') : t('scheduled.readOnly')}
        </p>
      )}

      {create.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      )}

      {scheduled.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : scheduled.isError ? (
        <QueryError onRetry={() => void scheduled.refetch()} />
      ) : scheduled.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('scheduled.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {scheduled.data.map((notification) => (
            <ScheduledRow
              key={notification.id}
              notification={notification}
              locale={i18n.language}
              canRemove={canSchedule}
              removing={remove.isPending && remove.variables === notification.id}
              onRemove={() => remove.mutate(notification.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduledRow({
  notification,
  locale,
  canRemove,
  removing,
  onRemove,
}: {
  notification: ScheduledNotification;
  locale: string;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const sent = notification.sentAt !== null;

  return (
    <li className="flex items-center gap-3 py-2">
      <BellRingIcon className={sent ? 'size-4 shrink-0 text-muted-foreground' : 'size-4 shrink-0'} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{notification.text}</p>
        <p className="text-xs text-muted-foreground">
          {formatScheduledAt(notification.sendAt, notification.timezone, locale)}
        </p>
      </div>
      {sent && <Badge variant="secondary">{t('scheduled.sent')}</Badge>}
      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('scheduled.remove', { text: notification.text })}
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? <Spinner /> : <Trash2Icon />}
        </Button>
      )}
    </li>
  );
}
