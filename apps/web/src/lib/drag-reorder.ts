import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

// How long a row takes to slide out of the way of the one being carried past it.
const SETTLE = 'transform 150ms ease';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Where a row sat before the drag began: its top down the page, and how tall it is. */
export interface RowBox {
  top: number;
  height: number;
}

/**
 * The place a row dragged from `from` by `dy` pixels belongs in: the last one whose neighbour it
 * has been carried past the middle of.
 *
 * The boxes are where the rows sat when the drag began, not where they have since been shifted
 * to — near enough at a row's height, and it keeps the answer from depending on how far through
 * the shifting animation the list happens to be.
 */
export function targetIndex(rows: readonly RowBox[], from: number, dy: number): number {
  const middle = (row: RowBox) => row.top + row.height / 2;
  const dragged = middle(rows[from]) + dy;
  let to = from;
  while (to > 0 && dragged < middle(rows[to - 1])) {
    to -= 1;
  }
  while (to < rows.length - 1 && dragged > middle(rows[to + 1])) {
    to += 1;
  }
  return to;
}

/** What the element that follows the pointer needs, spread onto the row's outermost element. */
export interface ReorderRowProps {
  ref: (element: HTMLElement | null) => void;
  style: CSSProperties;
}

/** What starts a drag, spread onto the grip the row is dragged by. */
export interface ReorderHandleProps {
  ref: (element: HTMLElement | null) => void;
  style: CSSProperties;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface DragReorder {
  /** Which row is being dragged, if one is — for lifting it off the list while it moves. */
  dragging: number | null;
  row: (index: number) => ReorderRowProps;
  handle: (index: number) => ReorderHandleProps;
}

// What is known about a drag only while a finger is down; the rest is state, because it is drawn.
interface Drag {
  pointerId: number;
  from: number;
  startY: number;
  rows: RowBox[];
}

// Where the row being dragged is, and where the rows it has passed have moved to make room.
interface Shift {
  from: number;
  to: number;
  dy: number;
  height: number;
  // Settled once, when the drag began, rather than asked for on every move.
  settle: string;
}

/**
 * Reordering a list by dragging its rows, for a list of `count` rows that calls `onMove` with
 * where a row went:
 *
 *     const reorder = useDragReorder(rows.length, (from, to) => setRows(move(rows, from, to)));
 *     <li {...reorder.row(index)}>
 *       <button {...reorder.handle(index)} aria-label={…}><GripVerticalIcon /></button>
 *
 * Only the grip starts a drag, so the list can still be scrolled with a finger anywhere else on
 * a row. The grip is also a button worth focusing: the up and down arrow keys move its row one
 * place at a time, and the focus follows it there, which is the whole gesture without a pointer.
 *
 * `onMove` is called once, when the row is let go, with where it started and where it landed —
 * nothing moves in the caller's own list while the drag is still going on, the rows only slide
 * out of the way to show where it would land.
 */
export function useDragReorder(count: number, onMove: (from: number, to: number) => void): DragReorder {
  const rows = useRef(new Map<number, HTMLElement>());
  const handles = useRef(new Map<number, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  // Which grip to focus once a keyboard move has been drawn: the row moved out from under the
  // focus, and a key that has to be found again is a key that can't be pressed twice.
  const focusing = useRef<number | null>(null);
  // Read when a drag ends, so a handler that changed in between is the one that runs.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const index = focusing.current;
    focusing.current = null;
    if (index !== null) {
      handles.current.get(index)?.focus();
    }
  });

  const elementRef = (map: typeof rows, index: number) => (element: HTMLElement | null) => {
    if (element) {
      map.current.set(index, element);
    } else {
      map.current.delete(index);
    }
  };

  // Down the page rather than down the window: a list long enough to scroll may be scrolled
  // under the pointer while a row is being dragged over it.
  const measure = (): RowBox[] => {
    const boxes: RowBox[] = [];
    for (let index = 0; index < count; index += 1) {
      const element = rows.current.get(index);
      if (!element) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      boxes.push({ top: rect.top + window.scrollY, height: rect.height });
    }
    return boxes;
  };

  // How far the row is drawn from where it started: it follows the pointer until it reaches an
  // end of the list, and stays there rather than being left hanging outside it. Only what is
  // drawn is held back — where the row lands is read from the pointer itself, so a firm drag
  // past the last row still puts it last, however exactly the two ends line up.
  const drawnTravel = (current: Drag, dy: number): number => {
    const first = current.rows[0];
    const last = current.rows[current.rows.length - 1];
    const dragged = current.rows[current.from];
    return Math.min(Math.max(dy, first.top - dragged.top), last.top + last.height - (dragged.top + dragged.height));
  };

  const finish = (current: Drag, to: number) => {
    drag.current = null;
    setShift(null);
    if (to !== current.from) {
      onMoveRef.current(current.from, to);
    }
  };

  const ongoing = (event: PointerEvent<HTMLElement>): Drag | null => {
    const current = drag.current;
    return current && current.pointerId === event.pointerId ? current : null;
  };

  return {
    dragging: shift?.from ?? null,
    row: (index) => {
      // Nothing eases while no row is being dragged. A drop drops the rows' shifts and puts the
      // caller's list in their new order in the same breath — the rows are already where they
      // belong, and easing a shift away from there would only slide them off it and back.
      const style: CSSProperties = { transition: 'none' };
      if (shift && index === shift.from) {
        // Under the pointer, above the rows it is passing, and not easing anywhere: it is held.
        style.transform = `translateY(${shift.dy}px)`;
        style.position = 'relative';
        style.zIndex = 1;
      } else if (shift) {
        style.transition = shift.settle;
        if (index > shift.from && index <= shift.to) {
          style.transform = `translateY(${-shift.height}px)`;
        } else if (index < shift.from && index >= shift.to) {
          style.transform = `translateY(${shift.height}px)`;
        }
      }
      return { ref: elementRef(rows, index), style };
    },
    handle: (index) => ({
      ref: elementRef(handles, index),
      // The grip's own movement is the app's; the rest of the row is left to the browser to
      // scroll, so a list can still be moved through while it is being reordered.
      style: { touchAction: 'none' },
      onPointerDown: (event) => {
        if (drag.current || !event.isPrimary || event.button !== 0) {
          return;
        }
        const boxes = measure();
        if (boxes.length !== count || count < 2) {
          return;
        }
        // The grip keeps the pointer for the whole drag, so the row follows it beyond its own
        // edges and the drag ends even if it is let go somewhere else entirely.
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, from: index, startY: event.pageY, rows: boxes };
        setShift({
          from: index,
          to: index,
          dy: 0,
          height: boxes[index].height,
          settle: prefersReducedMotion() ? 'none' : SETTLE,
        });
      },
      onPointerMove: (event) => {
        const current = ongoing(event);
        if (!current) {
          return;
        }
        const dy = event.pageY - current.startY;
        setShift((previous) =>
          previous && {
            ...previous,
            to: targetIndex(current.rows, current.from, dy),
            dy: drawnTravel(current, dy),
          },
        );
      },
      onPointerUp: (event) => {
        const current = ongoing(event);
        if (current) {
          finish(current, targetIndex(current.rows, current.from, event.pageY - current.startY));
        }
      },
      // A drag the browser took over — a system gesture, a screen the finger left: the row goes back.
      onPointerCancel: (event) => {
        const current = ongoing(event);
        if (current) {
          finish(current, current.from);
        }
      },
      onKeyDown: (event) => {
        const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        const to = index + delta;
        if (delta === 0 || to < 0 || to >= count) {
          return;
        }
        // Otherwise the page scrolls under the row that just moved.
        event.preventDefault();
        focusing.current = to;
        onMoveRef.current(index, to);
      },
    }),
  };
}
