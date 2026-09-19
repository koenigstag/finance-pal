# Push notifications

The app can notify someone while it is closed: a co-member records a transaction, someone adds
them to a group, a planned transaction comes round. It is Web Push — the standard the browsers
implement — so there is no Firebase project and no app store involved, and a notification travels
through whichever push service the device's browser trusts.

This is the counterpart to the live updates over the socket, not a replacement for them. An open
app refetches what changed (`libs/shared/contracts/.../realtime-event.ts`); a closed one gets a
notification, if its owner asked for one.

Push is **optional**. Without VAPID keys the API answers that it isn't set up, the app hides the
switch, and nothing else changes.

## Setting it up

Generate one VAPID key pair, once:

```sh
pnpm --filter @ft/api exec web-push generate-vapid-keys
```

Put all three values in the API's environment:

```sh
VAPID_PUBLIC_KEY=BN...      # not a secret: every device that subscribes is given it
VAPID_PRIVATE_KEY=...       # a secret
VAPID_SUBJECT=mailto:you@example.com   # who a push service can contact about this deployment
```

They are validated together at startup: one key without the other, or keys without a subject,
fail fast rather than leaving the app offering a switch that could only fail.

**Keep the pair.** Every device is registered against the public key it subscribed with, so a new
pair stops reaching all of them — silently, because a push service has no way to say "wrong key,
this device is fine". Rotating means asking everyone to turn notifications on again.

On the VPS the keys go in `~/.config/containers/env/finance-api.env`, where `deploy/vps/init-env.sh`
leaves commented placeholders for them. It never generates them itself, precisely because a deploy
must not be able to replace a pair that is in use.

## Trying it locally

A development server registers no service worker, so there is nothing to receive a push: the
settings card says as much. Build and preview instead, which serves the worker the app really
uses:

```sh
pnpm nx build web && pnpm nx preview web
```

Push also needs a secure context. `localhost` counts as one; another machine on the network does
not, so a phone on the same Wi-Fi needs HTTPS in front of it.

Then, in **Settings → Notifications**, turn notifications on and send a test. The test goes to
every device the signed-in person has registered, whatever they left switched on — it answers
"do notifications arrive here at all", which is the question worth asking first.

## What gets sent

| Switch                  | On by default | Sent when                                                      | To                                |
| ----------------------- | ------------- | -------------------------------------------------------------- | --------------------------------- |
| What others record      | no            | A transaction is recorded, dated now or earlier                 | Everyone in the group but whoever recorded it |
| Being added to a group  | yes           | Someone is added to a group                                     | The person who was added          |
| Planned transactions    | yes           | A series' planned occurrence lands and the next one is written  | Everyone in the group             |

Each is a switch per device, so a phone can buzz about all three and a laptop about none.

**What others record is off until someone turns it on.** It is the one most worth having in a
group that wants it, and in a busy shared budget also the most frequent thing that happens — an
app that buzzes on every coffee is one whose notifications get turned off altogether, taking the
other two with them. It is offered unticked rather than not offered, and an open app shows every
change at once over the socket either way.

A notification carries a title (the group's name), one line, and a link into the app. It is
written in the language of whoever receives it, not whoever set it off — two people in one group
may well read the app in different languages — from the catalogue in
`apps/api/src/modules/push/push-messages.ts`. It deliberately carries no more than the line being
shown: it is rendered by the operating system, often on a locked screen.

Edits and deletions are not notified. The socket reports them to whoever is looking, and a
notification for every correction to a figure would be noise.

## How it fits together

- `libs/shared/contracts/src/lib/push/` — the routes, the topics, and the payload shape the API
  and the service worker agree on.
- `apps/api/src/modules/push/` — registering devices, composing messages, and the one place that
  talks to push services. Feature modules call `PushNotificationsService` and say what happened;
  nothing else there is theirs.
- `apps/web/public/push-handler.js` — the app's half of the service worker, imported by the one
  Workbox generates. It shows the notification and decides where tapping it goes.
- `apps/web/src/features/push/` — permission, the browser's subscription, and the settings card.

Devices live in `push_subscriptions`, one row per browser, behind a row-level security policy that
shows a person their own and nobody else's. Sending goes the other way — the recipients are by
definition not the caller, and it happens after the caller's transaction has committed — so the
three queries that reach other people's rows are `SECURITY DEFINER` functions installed by the
table's migration, which take no device and no topic from outside.

Sending is best-effort throughout, and never part of a request's own success: a push service being
down must not fail a transaction. A device the push service reports as gone is deleted rather than
retried forever.

## When notifications don't arrive

- **iPhone or iPad**: Safari only offers push to a web app added to the home screen. Until then
  the card says the browser can't show notifications.
- **The browser was told no**: it won't ask again. Its own site settings are the only way back,
  which is what the card says.
- **The switch is off although the browser has a subscription**: the API's list is what the switch
  reflects, because the API's copy is what actually gets sent to. Turning it on re-registers the
  subscription the browser already has.
- **Signing out** takes the device off the list, so a browser someone has signed out of stops
  getting their notifications.
