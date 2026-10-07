import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Breathing room between the top of the list and the separator.
const GAP_PX = 8;
// Frames to keep adjusting while the list's layout settles (rows, icons and pickers load after
// the transactions do).
const MAX_ATTEMPTS = 10;

// How far down each list was scrolled when last seen, by key. Going to another tab unmounts the
// transactions page, lists and all; when it comes back, a list can then be put where it was left.
const lastScrollTops = new Map<string, number>();

/**
 * Scrolls a transaction list — `scrollerRef`, the element that scrolls it, not the page — so the
 * separator between planned (future-dated) and already happened transactions sits at its top,
 * leaving the planned ones above it, to be found by scrolling up. Everything outside the scroller
 * (title, month, filters) stays where it is.
 *
 * Runs once per `key` (a month and filter selection) as soon as the list is `ready`, so refetches
 * after adding or editing a transaction, or loading more, never jump the list. Without a separator
 * (nothing planned, or nothing happened yet) it starts the new selection from the top.
 *
 * A selection seen before whose list comes back ready at once, its pages still loaded — the page
 * was left for another tab and come back to, say — is put back where it was left instead. One
 * that has to load anew starts on today again, as the first time: what was scrolled down to may
 * not have loaded yet.
 *
 * Returns the height of the spacer to render at the end of the scroller: without enough content
 * below the separator, or below where the list was left, it couldn't scroll that far.
 */
export function useTodayAnchor(scrollerRef: RefObject<HTMLElement | null>, key: string, ready: boolean): number {
  const [spacer, setSpacer] = useState(0);
  // The selection the list on screen shows, once it has been put in place; null while it loads.
  const placedKey = useRef<string | null>(null);
  // A selection the list had to load, rather than one that came with its pages.
  const loadingKey = useRef<string | null>(null);

  // Notes where the list is scrolled to, for the selection it shows, as it goes.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const note = () => {
      if (placedKey.current !== null) {
        lastScrollTops.set(placedKey.current, scroller.scrollTop);
      }
    };
    scroller.addEventListener('scroll', note, { passive: true });
    return () => scroller.removeEventListener('scroll', note);
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!ready) {
      if (placedKey.current !== key) {
        // Whatever the list shows meanwhile isn't this selection, nor the one before it any more.
        placedKey.current = null;
        loadingKey.current = key;
      }
      return;
    }
    if (!scroller || placedKey.current === key) {
      return;
    }
    placedKey.current = key;
    setSpacer(0);
    const leftAt = loadingKey.current === key ? undefined : lastScrollTops.get(key);
    loadingKey.current = null;

    // Where to scroll to, frame by frame; null once there's no longer anything to scroll to.
    let target: () => number | null;
    if (leftAt !== undefined) {
      target = () => leftAt;
    } else {
      lastScrollTops.delete(key);
      if (!scroller.querySelector('[data-today-anchor]')) {
        scroller.scrollTop = 0;
        return;
      }
      target = () => {
        const anchor = scroller.querySelector<HTMLElement>('[data-today-anchor]');
        return anchor
          ? anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - GAP_PX
          : null;
      };
    }

    // Measured and applied frame by frame rather than once: the layout can still change after the
    // first render, and a scroll past the current end gets clamped short. Each frame scrolls to
    // the target and, if the list ends too soon, grows the spacer by what's missing.
    let frame = 0;
    let attempt = 0;
    const settle = () => {
      const top = target();
      if (top === null || placedKey.current !== key) {
        return;
      }
      scroller.scrollTo({ top, behavior: 'instant' });
      const missing = Math.ceil(top - scroller.scrollTop);
      if (missing > 1) {
        setSpacer((current) => current + missing);
      }
      if (++attempt < MAX_ATTEMPTS && (missing > 1 || attempt < 3)) {
        frame = requestAnimationFrame(settle);
      }
    };
    frame = requestAnimationFrame(settle);
    return () => {
      cancelAnimationFrame(frame);
      // Interrupted before the first frame (e.g. React's development double-run of effects): let
      // the next run place this selection instead of skipping it as done.
      if (attempt === 0) {
        placedKey.current = null;
      }
    };
  }, [scrollerRef, key, ready]);

  return spacer;
}
