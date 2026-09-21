import { BellIcon, BellOffIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PUSH_TOPICS, type PushTopic } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { isPushSupported, notificationPermission } from './push';
import {
  useDeviceRegistration,
  useDisablePush,
  useEnablePush,
  usePushSubscriptions,
  useSendTestPush,
  useSetPushTopics,
} from './queries';

/**
 * Notifications for this device, and nothing about any other: a phone and a laptop are registered
 * separately and can be told about different things.
 *
 * What the API has registered is what the switch reflects, not what the browser holds — a browser
 * can keep a subscription the API has forgotten, and only the API's copy is ever sent to.
 *
 * The key comes from the page rather than from a query of its own: whether this deployment does
 * push at all is the page's question, and a card asked to draw itself without one would have
 * nothing to say.
 */
export function NotificationsCard({ publicKey }: { publicKey: string }) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(notificationPermission());
  const device = useDeviceRegistration();
  const subscriptions = usePushSubscriptions();
  const enable = useEnablePush();
  const disable = useDisablePush();
  const setTopics = useSetPushTopics();
  const test = useSendTestPush();

  const supported = isPushSupported();
  // This browser's own row, if the API has one: the switch, and where the topics come from.
  const registered = device.data ? subscriptions.data?.find((row) => row.endpoint === device.data?.endpoint) : undefined;
  const busy = enable.isPending || disable.isPending || setTopics.isPending;

  const toggleTopic = (topic: PushTopic, wanted: boolean) => {
    if (!device.data || !registered) {
      return;
    }
    const topics = wanted ? [...registered.topics, topic] : registered.topics.filter((kept) => kept !== topic);
    setTopics.mutate({ device: device.data, topics });
  };

  let content;
  if (!supported) {
    // Safari only offers push to a web app that has been added to the home screen, so this is
    // what an iPhone shows until the app is installed.
    content = <p className="text-sm text-muted-foreground">{t('settings.notifications.unsupported')}</p>;
  } else if (permission === 'denied') {
    // The browser won't ask again once it has been told not to; only its own settings can undo it.
    content = (
      <Alert>
        <AlertDescription>{t('settings.notifications.blocked')}</AlertDescription>
      </Alert>
    );
  } else if (subscriptions.isPending || device.isPending) {
    content = <Spinner className="mx-auto size-5 text-muted-foreground" />;
  } else if (!registered) {
    content = (
      <>
        <p className="text-sm text-muted-foreground">{t('settings.notifications.off')}</p>
        <Button
          disabled={busy}
          onClick={() =>
            enable.mutate({ publicKey }, { onSuccess: (result) => setPermission(result.permission) })
          }
        >
          {enable.isPending ? <Spinner /> : <BellIcon />}
          {t('settings.notifications.enable')}
        </Button>
        {/* The browser said yes but there was no service worker to register with — a development
            server, or a first visit that hasn't installed one yet. */}
        {enable.data?.permission === 'granted' && !enable.data.registered && (
          <Alert>
            <AlertDescription>{t('settings.notifications.noWorker')}</AlertDescription>
          </Alert>
        )}
      </>
    );
  } else {
    content = (
      <>
        {PUSH_TOPICS.map((topic) => (
          <Field key={topic} orientation="horizontal">
            <Checkbox
              id={`push-topic-${topic}`}
              checked={registered.topics.includes(topic)}
              disabled={busy}
              onCheckedChange={(checked) => toggleTopic(topic, checked === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor={`push-topic-${topic}`}>{t(`settings.notifications.topics.${topic}.label`)}</FieldLabel>
              <FieldDescription>{t(`settings.notifications.topics.${topic}.description`)}</FieldDescription>
            </FieldContent>
          </Field>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner /> : <SendIcon />}
            {t('settings.notifications.test')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => disable.mutate(registered.endpoint)}>
            {disable.isPending ? <Spinner /> : <BellOffIcon />}
            {t('settings.notifications.disable')}
          </Button>
        </div>

        {test.isSuccess && (
          <p className="text-sm text-muted-foreground">
            {test.data.sent > 0
              ? t('settings.notifications.tested', { count: test.data.sent })
              : t('settings.notifications.testedNone')}
          </p>
        )}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.notifications.thisDevice')}</CardTitle>
        <CardDescription>{t('settings.notifications.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {content}
        {(enable.isError || disable.isError || setTopics.isError || test.isError) && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
