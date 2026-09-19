import { useRef, type CSSProperties, type TouchEvent } from 'react';

// How far a finger has to travel sideways before it counts as a swipe rather than a tap that
// wandered, or the slant of a scroll.
const MIN_DISTANCE_PX = 56;
// And how much further sideways than up and down, so a diagonal drag doesn't navigate by accident.
const DIRECTION_RATIO = 1.6;
// Once a finger has gone this far up or down, the gesture is a scroll and stays one, however it
// ends: a long scroll drifting sideways must never navigate.
const SCROLL_CANCEL_PX = 40;

export type SwipeDirection = 'left' | 'right';

/**
 * Which way a finger went, or null when that was no sideways swipe: too short, or as much up and
 * down as across. `dx` and `dy` are how far it moved from where it started, in CSS pixels.
 */
export function swipeDirection(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) {
    return null;
  }
  return dx < 0 ? 'left' : 'right';
}

/** What a swipeable element needs, spread onto it; it carries a style, so merge one of your own. */
export interface SwipeProps {
  style: CSSProperties;
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onTouchEnd: (event: TouchEvent) => void;
  onTouchCancel: () => void;
}

/**
 * Sideways swipes on an element — what a phone expects where a mouse has buttons to click:
 *
 *     <div {...useSwipe((direction) => go(direction === 'left' ? -1 : 1))}>
 *
 * Only one finger at a time counts, so a pinch never navigates, and only a decisive sideways
 * move: anything that goes up and down on the way is the scroll it looks like. The props claim
 * the element's sideways movement for the app, leaving the browser to scroll it up and down and
 * to zoom it, but stopping it from reading a sideways drag as a scroll or a step back in history.
 */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void): SwipeProps {
  const start = useRef<{ x: number; y: number } | null>(null);
  // Read when the gesture ends, so a handler that changed in between is the one that runs.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  const cancel = () => {
    start.current = null;
  };

  return {
    style: { touchAction: 'pan-y pinch-zoom' },
    // A second finger lands as another touchstart, which leaves no gesture to follow.
    onTouchStart: (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchMove: (event) => {
      const from = start.current;
      const touch = event.touches[0];
      if (from && touch && Math.abs(touch.clientY - from.y) > SCROLL_CANCEL_PX) {
        cancel();
      }
    },
    onTouchEnd: (event) => {
      const from = start.current;
      const to = event.changedTouches[0];
      cancel();
      if (!from || !to) {
        return;
      }
      const direction = swipeDirection(to.clientX - from.x, to.clientY - from.y);
      if (direction) {
        onSwipeRef.current(direction);
      }
    },
    onTouchCancel: cancel,
  };
}
