import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

// How long after opening the app counts as "still starting": long enough for a worker that is
// already waiting to be noticed, short enough that nobody is mid-sentence.
const STARTUP_MS = 10_000;
// A tab left open for a day should still fetch the new version, even though it only applies it at
// the next start. The check is one small file, which the browser skips when nothing changed.
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Updates the app without asking, but only while it is starting.
 *
 * A new version installs in the background and then waits. If it becomes ready in the first
 * seconds after opening — before anyone has touched anything — it is applied at once and the page
 * reloads, which nobody notices. Later in the session it keeps waiting: reloading under a
 * half-typed transaction to save a few hours is a bad trade. The next start picks it up.
 *
 * The one thing that does interrupt is an error, not an update: code from before a release asking
 * for a file that release no longer has. There is nothing to do but reload, so it says so.
 */
export function AppUpdater() {
  const { t } = useTranslation();
  const [staleChunk, setStaleChunk] = useState(false);
  const openedAt = useRef(Date.now());
  const touched = useRef(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) {
        setInterval(() => void registration.update(), CHECK_EVERY_MS);
      }
    },
  });

  useEffect(() => {
    const onTouch = () => {
      touched.current = true;
    };
    const onPreloadError = () => setStaleChunk(true);
    window.addEventListener('pointerdown', onTouch, { once: true });
    window.addEventListener('keydown', onTouch, { once: true });
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => {
      window.removeEventListener('pointerdown', onTouch);
      window.removeEventListener('keydown', onTouch);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }, []);

  useEffect(() => {
    if (needRefresh && !touched.current && Date.now() - openedAt.current < STARTUP_MS) {
      // Takes the waiting worker into service and reloads: the app is a second old, so there is
      // nothing on screen to lose.
      void updateServiceWorker(true);
    }
  }, [needRefresh, updateServiceWorker]);

  if (!staleChunk) {
    return null;
  }

  return (
    <div
      role="status"
      // Above the bottom navigation on a phone, clear of the floating action button.
      className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-2 rounded-xl border bg-popover p-2 pl-3 text-sm shadow-lg md:right-4 md:bottom-4 md:left-auto md:mx-0"
    >
      <span className="flex-1">{t('pwa.update.stale')}</span>
      <Button size="sm" onClick={() => window.location.reload()}>
        <RefreshCwIcon />
        {t('pwa.update.reload')}
      </Button>
    </div>
  );
}
