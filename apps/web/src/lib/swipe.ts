import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type TouchEvent } from 'react';

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

// A drag picks its axis in the first few pixels and keeps it: a list being scrolled must not
// drift sideways, and a panel being dragged must not be stopped by a wobble.
const AXIS_GATE_PX = 12;
// How far across the next panel has to be dragged before letting go moves to it…
const COMMIT_FRACTION = 0.28;
// …unless it was flicked: this fast, in CSS pixels per millisecond, and this far, and it counts
// whatever the distance.
const FLICK_VELOCITY = 0.45;
const FLICK_MIN_PX = 32;
// How long the track takes to reach where it is going once the finger has left it.
const SETTLE_MS = 240;
// Slow at the end rather than the start: the track carries on from the finger, it doesn't start.
const SETTLE_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
// If the panels never move under a strip that has arrived — the caller ignored the move, or is
// slow — it goes back to its middle panel anyway rather than sitting off to one side.
const RECENTRE_FALLBACK_MS = 400;

function clamp(value: number, limit: number): number {
  return Math.min(Math.max(value, -limit), limit);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export interface SwipeTrackProps {
  viewport: {
    ref: (element: HTMLElement | null) => void;
    style: CSSProperties;
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: (event: TouchEvent) => void;
    onTouchCancel: () => void;
  };
  /** For the track inside the viewport: three panels wide, resting on the middle one. */
  track: CSSProperties;
  /** Which panel is nearest the middle right now — the one the user would call "on screen". */
  showing: -1 | 0 | 1;
  /** Steps straight to a neighbour, for buttons that do what a drag does. */
  step: (delta: -1 | 1) => void;
}

// Where the strip is: resting on its middle panel, easing towards a neighbour, or arrived at one
// and waiting for the caller to move the panels under it.
type Phase =
  | { kind: 'rest' }
  | { kind: 'sliding'; timer: ReturnType<typeof setTimeout> }
  | { kind: 'landing'; from: string; timer: ReturnType<typeof setTimeout> };

/**
 * Three panels on a strip that follows a finger, for stepping through something a panel at a
 * time while seeing what is on either side of it:
 *
 *     const strip = useSwipeTrack(monthKey, (delta) => goToMonth(delta));
 *     <div {...strip.viewport} className="overflow-hidden">
 *       <div style={strip.track} className="flex h-full w-full">…three panels, each w-full…</div>
 *     </div>
 *
 * `delta` is which neighbour was moved to: -1 the panel to the left, 1 the one to the right. It
 * arrives once the strip has finished easing there, so the caller re-centres its three panels on
 * a month the strip is already showing.
 *
 * `position` says what the middle panel is currently showing — the month key, here. The strip
 * stays where it landed until that changes, and only then goes back to its middle panel, so the
 * swap happens in the same frame as the panels move and nothing flickers. (React Router renders a
 * navigation as a transition, a frame or more after the state change that asked for it: re-centring
 * on a timer instead would put the month that was just left back on screen in between.)
 *
 * Dragging follows the finger and goes nowhere by itself: the move only happens if the finger
 * crossed most of a panel, or flicked it. A drag that starts by going up or down is a scroll and
 * stays one, and a second finger is a pinch, which is the browser's.
 *
 * `step` is for buttons, and doesn't slide: a press is a discrete thing, and pressing again and
 * again has to keep up rather than queue behind an animation it can't interrupt. With the
 * neighbouring panels already on the strip there is nothing to wait for anyway — what a slide
 * would reveal is what a press shows at once.
 */
export function useSwipeTrack(position: string, onCommit: (delta: -1 | 1) => void): SwipeTrackProps {
  const [state, setState] = useState<{ offset: number; settling: boolean; showing: -1 | 0 | 1 }>({
    offset: 0,
    settling: false,
    showing: 0,
  });
  const viewport = useRef<HTMLElement | null>(null);
  const drag = useRef<{ x: number; y: number; at: number; width: number; axis: 'x' | 'y' | null } | null>(null);
  const phase = useRef<Phase>({ kind: 'rest' });
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const positionRef = useRef(position);
  positionRef.current = position;

  const rest = useCallback(() => {
    if (phase.current.kind !== 'rest') {
      clearTimeout(phase.current.timer);
    }
    phase.current = { kind: 'rest' };
    setState({ offset: 0, settling: false, showing: 0 });
  }, []);

  // Hands the move over and waits, still showing the panel it arrived at, for the caller to put
  // that panel in the middle. The fallback covers a caller that never does.
  const land = useCallback(
    (delta: -1 | 1) => {
      phase.current = { kind: 'landing', from: positionRef.current, timer: setTimeout(rest, RECENTRE_FALLBACK_MS) };
      onCommitRef.current(delta);
    },
    [rest],
  );

  const slide = useCallback(
    (delta: -1 | 0 | 1, width: number) => {
      // One move at a time: the strip is either following a finger or playing that out.
      if (phase.current.kind !== 'rest') {
        return;
      }
      if (delta === 0) {
        setState({ offset: 0, settling: true, showing: 0 });
        phase.current = { kind: 'sliding', timer: setTimeout(rest, SETTLE_MS) };
        return;
      }
      if (width === 0 || prefersReducedMotion()) {
        land(delta);
        return;
      }
      setState({ offset: -delta * width, settling: true, showing: delta });
      phase.current = { kind: 'sliding', timer: setTimeout(() => land(delta), SETTLE_MS) };
    },
    [land, rest],
  );

  useLayoutEffect(() => {
    if (phase.current.kind === 'landing' && phase.current.from !== position) {
      rest();
    }
  }, [position, rest]);

  useEffect(
    () => () => {
      if (phase.current.kind !== 'rest') {
        clearTimeout(phase.current.timer);
      }
    },
    [],
  );

  return {
    viewport: {
      ref: (element) => {
        viewport.current = element;
      },
      // The browser keeps scrolling the panel up and down, and keeps pinch-zoom; sideways is ours.
      style: { touchAction: 'pan-y pinch-zoom' },
      onTouchStart: (event) => {
        const touch = event.touches.length === 1 && phase.current.kind === 'rest' ? event.touches[0] : undefined;
        drag.current = touch
          ? { x: touch.clientX, y: touch.clientY, at: Date.now(), width: event.currentTarget.clientWidth, axis: null }
          : null;
      },
      onTouchMove: (event) => {
        const from = drag.current;
        const touch = event.touches[0];
        if (!from || !touch) {
          return;
        }
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (from.axis === null) {
          // Whichever way the finger commits to first is the way this gesture goes.
          if (Math.abs(dx) < AXIS_GATE_PX && Math.abs(dy) < AXIS_GATE_PX) {
            return;
          }
          if (Math.abs(dy) >= Math.abs(dx)) {
            drag.current = null;
            return;
          }
          // Measured from here on, so the strip picks the finger up where it is rather than
          // jumping the gate's worth.
          from.axis = 'x';
          from.x = touch.clientX;
          from.at = Date.now();
          return;
        }
        const offset = clamp(touch.clientX - from.x, from.width);
        const half = from.width / 2;
        setState({ offset, settling: false, showing: offset <= -half ? 1 : offset >= half ? -1 : 0 });
      },
      onTouchEnd: (event) => {
        const from = drag.current;
        drag.current = null;
        if (!from || from.axis !== 'x') {
          return;
        }
        const touch = event.changedTouches[0];
        const dx = touch ? clamp(touch.clientX - from.x, from.width) : 0;
        const flicked = Math.abs(dx) >= FLICK_MIN_PX && Math.abs(dx) / Math.max(Date.now() - from.at, 1) >= FLICK_VELOCITY;
        const far = Math.abs(dx) >= from.width * COMMIT_FRACTION;
        slide(!far && !flicked ? 0 : dx < 0 ? 1 : -1, from.width);
      },
      onTouchCancel: () => {
        const from = drag.current;
        drag.current = null;
        if (from?.axis === 'x') {
          slide(0, from.width);
        }
      },
    },
    track: {
      // The middle panel of three, plus however far the finger has taken it.
      transform: `translateX(calc(-100% + ${state.offset}px))`,
      transition: state.settling ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none',
    },
    showing: state.showing,
    step: (delta) => {
      // Never on top of a drag that is still playing out: that one is about to move the panels.
      if (phase.current.kind === 'rest') {
        onCommitRef.current(delta);
      }
    },
  };
}
