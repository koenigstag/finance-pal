import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Breathing room between the top of the list and the separator.
const GAP_PX = 8;
// Frames to keep adjusting while the list's layout settles (rows, icons and pickers load after
// the transactions do).
const MAX_ATTEMPTS = 10;

/**
 * Scrolls a transaction list — `scrollerRef`, the element that scrolls it, not the page — so the
 * separator between planned (future-dated) and already happened transactions sits at its top,
 * leaving the planned ones above it, to be found by scrolling up. Everything outside the scroller
 * (title, month, filters) stays where it is.
 *
 * Runs once per `key` (a month and filter selection) as soon as the list is `ready`, so refetches
 * after adding or editing a transaction, or loading more, never jump the list. Without a separator
 * (nothing planned, or nothing happened yet) it starts the new selection from the top. Returns the
 * height of the spacer to render at the end of the scroller: without enough content below the
 * separator, the list couldn't scroll far enough to put it at the top.
 */
export function useTodayAnchor(scrollerRef: RefObject<HTMLElement | null>, key: string, ready: boolean): number {
  const [spacer, setSpacer] = useState(0);
  const anchoredKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!ready || !scroller || anchoredKey.current === key) {
      return;
    }
    anchoredKey.current = key;
    setSpacer(0);

    if (!scroller.querySelector('[data-today-anchor]')) {
      scroller.scrollTop = 0;
      return;
    }

    // Measured and applied frame by frame rather than once: the layout below the separator can
    // still change after the first render, and a scroll past the current end gets clamped short.
    // Each frame scrolls to the separator and, if the list ends too soon, grows the spacer by
    // what's missing.
    let frame = 0;
    let attempt = 0;
    const settle = () => {
      const anchor = scroller.querySelector<HTMLElement>('[data-today-anchor]');
      if (!anchor || anchoredKey.current !== key) {
        return;
      }
      const top = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - GAP_PX;
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
      // the next run anchor this selection instead of skipping it as done.
      if (attempt === 0) {
        anchoredKey.current = null;
      }
    };
  }, [scrollerRef, key, ready]);

  return spacer;
}
