/*
 * Notifications, in the service worker.
 *
 * The generated worker pulls this in (see workbox.importScripts in vite.config.mts): that build
 * is Workbox's own, so the app's part of it lives here, in plain JavaScript, rather than in a
 * worker of ours that would have to reproduce the caching it does.
 *
 * A push arrives here whether or not the app is open — that is the whole point of it, and the
 * reason it is a worker rather than a page. The payload was encrypted to this device by the API
 * (see PushPayload in libs/shared/contracts) and is already written in its owner's language: a
 * worker has no catalogue and no chance to fetch one before the notification has to be on screen.
 *
 * Edits here reach a browser on its next worker update, but through the HTTP cache rather than
 * the worker's own bypass — an imported script is fetched the ordinary way — so a change can lag
 * by whatever the host serves this file with. GitHub Pages caches it for ten minutes.
 *
 * `pushsubscriptionchange`, for when a browser replaces a subscription behind the app's back, is
 * deliberately not handled here: re-registering means an authenticated call, and a worker holds
 * no session. The app reconciles instead — the API's list of devices is what the settings switch
 * reflects, so a subscription it has never been told about reads as off until it is registered.
 */

/* global self, clients */

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  if (!payload) {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // Notifications about one group replace one another rather than stacking up: five
      // transactions recorded while the phone was away are one line about the last.
      tag: payload.tag,
      // Resolved against the worker's own scope, so it holds under a project path on GitHub Pages
      // just as it does at a domain root.
      icon: new URL('icon-192.png', self.registration.scope).href,
      data: { path: payload.path },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.path;
  const target = new URL(path || '', self.registration.scope);

  event.waitUntil(
    (async () => {
      // A tab that is already open is brought forward and taken to the page, rather than a second
      // copy of the app being opened beside it.
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        if (path && 'navigate' in open && open.url !== target.href) {
          await open.navigate(target.href);
        }
        return;
      }
      await clients.openWindow(target.href);
    })(),
  );
});

// A payload this build doesn't understand — from a newer API, or no payload at all — is passed
// over rather than shown as an empty notification.
function readPayload(event) {
  if (!event.data) {
    return null;
  }
  try {
    const payload = event.data.json();
    return payload && typeof payload.title === 'string' && typeof payload.body === 'string' ? payload : null;
  } catch {
    return null;
  }
}
