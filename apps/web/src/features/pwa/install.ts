import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Installing the app, and knowing whether the network is there.
 *
 * Chrome and friends fire `beforeinstallprompt` when the app qualifies, and only then can it be
 * installed from a button. Safari never fires it: on iOS the browser's own Share → Add to Home
 * Screen is the only way, so there the app says so rather than offering a button that can't work.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Kept for a button of our own rather than the browser's own mini-infobar.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the app can be installed from a button right now. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}

/** Asks the browser to install the app; resolves to whether the person accepted. */
export async function installApp(): Promise<boolean> {
  if (!deferred) {
    return false;
  }
  const prompt = deferred;
  deferred = null;
  notify();
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
}

/** Already installed: launched from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS marks a home-screen launch here instead.
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

/** Whether the browser thinks it has a network. Not a promise that the API answers. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
