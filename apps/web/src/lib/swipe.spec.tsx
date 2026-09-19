import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { swipeDirection, useSwipe, useSwipeTrack, type SwipeDirection } from './swipe';

describe('swipeDirection', () => {
  it('reads a decisive sideways move', () => {
    expect(swipeDirection(-80, 0)).toBe('left');
    expect(swipeDirection(80, 0)).toBe('right');
    expect(swipeDirection(-80, 20)).toBe('left');
  });

  it('ignores a move too short to mean anything', () => {
    expect(swipeDirection(-40, 0)).toBeNull();
    expect(swipeDirection(40, 0)).toBeNull();
    expect(swipeDirection(0, 0)).toBeNull();
  });

  it('ignores a move that went as much up and down as across', () => {
    expect(swipeDirection(-80, 60)).toBeNull();
    expect(swipeDirection(80, -80)).toBeNull();
    expect(swipeDirection(0, 200)).toBeNull();
  });
});

describe('useSwipe', () => {
  const setup = () => {
    const onSwipe = vi.fn<(direction: SwipeDirection) => void>();
    function Swipeable() {
      return <div data-testid="target" {...useSwipe(onSwipe)} />;
    }
    render(<Swipeable />);
    return { onSwipe, target: screen.getByTestId('target') };
  };

  const touch = (x: number, y: number) => [{ clientX: x, clientY: y }];

  it('leaves the element scrolling and zooming, and takes sideways moves', () => {
    const { target } = setup();
    expect(target.style.touchAction).toBe('pan-y pinch-zoom');
  });

  it('reports the direction a finger went', () => {
    const { onSwipe, target } = setup();

    fireEvent.touchStart(target, { touches: touch(200, 100) });
    fireEvent.touchMove(target, { touches: touch(120, 104) });
    fireEvent.touchEnd(target, { changedTouches: touch(100, 106) });

    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('left');

    fireEvent.touchStart(target, { touches: touch(100, 100) });
    fireEvent.touchEnd(target, { changedTouches: touch(200, 100) });

    expect(onSwipe).toHaveBeenLastCalledWith('right');
  });

  it('stays out of the way of a scroll, even one that ends sideways', () => {
    const { onSwipe, target } = setup();

    fireEvent.touchStart(target, { touches: touch(200, 300) });
    fireEvent.touchMove(target, { touches: touch(190, 100) });
    fireEvent.touchEnd(target, { changedTouches: touch(100, 300) });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('ignores a pinch', () => {
    const { onSwipe, target } = setup();

    fireEvent.touchStart(target, { touches: touch(200, 100) });
    fireEvent.touchStart(target, { touches: [...touch(200, 100), ...touch(240, 140)] });
    fireEvent.touchEnd(target, { changedTouches: touch(100, 100) });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('forgets a gesture the browser took over', () => {
    const { onSwipe, target } = setup();

    fireEvent.touchStart(target, { touches: touch(200, 100) });
    fireEvent.touchCancel(target, { changedTouches: touch(150, 100) });
    fireEvent.touchEnd(target, { changedTouches: touch(100, 100) });

    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe('useSwipeTrack', () => {
  // jsdom lays nothing out, so every element measures 0 wide; the strip needs a width to
  // reckon the distance a drag has to cross against.
  const WIDTH = 400;
  let clientWidth: PropertyDescriptor | undefined;

  beforeAll(() => {
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: WIDTH });
  });

  afterAll(() => {
    if (clientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A caller that moves its panels when told to, as the transactions page does.
  function Strip({ onCommit, moves = true }: { onCommit: (delta: -1 | 1) => void; moves?: boolean }) {
    const [at, setAt] = useState(0);
    const strip = useSwipeTrack(String(at), (delta) => {
      onCommit(delta);
      if (moves) {
        setAt((current) => current + delta);
      }
    });
    return (
      <div data-testid="viewport" {...strip.viewport}>
        <div data-testid="track" style={strip.track} />
        <span data-testid="showing">{strip.showing}</span>
        <span data-testid="at">{at}</span>
        <button data-testid="step-forward" onClick={() => strip.step(1)} />
      </div>
    );
  }

  const setup = (moves?: boolean) => {
    const onCommit = vi.fn<(delta: -1 | 1) => void>();
    render(<Strip onCommit={onCommit} moves={moves} />);
    const track = screen.getByTestId('track');
    return {
      onCommit,
      viewport: screen.getByTestId('viewport'),
      // How far the strip sits from its middle panel, in pixels.
      offset: () => Number(/\+ (-?\d+)px/.exec(track.style.transform)?.[1] ?? NaN),
      easing: () => track.style.transition !== 'none',
      showing: () => screen.getByTestId('showing').textContent,
      at: () => screen.getByTestId('at').textContent,
    };
  };

  const at = (x: number, y = 300) => [{ clientX: x, clientY: y }];

  it('follows the finger, without easing, and says which panel it is nearest', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(300) });
    fireEvent.touchMove(strip.viewport, { touches: at(280) });
    fireEvent.touchMove(strip.viewport, { touches: at(220) });

    expect(strip.offset()).toBe(-60);
    expect(strip.easing()).toBe(false);
    expect(strip.showing()).toBe('0');

    // Past halfway the panel coming in is the one being shown, name and all.
    fireEvent.touchMove(strip.viewport, { touches: at(60) });
    expect(strip.showing()).toBe('1');
  });

  it('leaves a gesture that starts by going up or down to the list', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(300, 300) });
    fireEvent.touchMove(strip.viewport, { touches: at(296, 260) });
    fireEvent.touchMove(strip.viewport, { touches: at(100, 250) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(100, 250) });
    act(() => vi.runAllTimers());

    expect(strip.offset()).toBe(0);
    expect(strip.onCommit).not.toHaveBeenCalled();
  });

  it('springs back from a drag that stopped short, and moves nowhere', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(300) });
    fireEvent.touchMove(strip.viewport, { touches: at(280) });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.touchMove(strip.viewport, { touches: at(240) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(240) });

    expect(strip.easing()).toBe(true);
    act(() => vi.runAllTimers());
    expect(strip.offset()).toBe(0);
    expect(strip.onCommit).not.toHaveBeenCalled();
  });

  it('moves to the panel a long drag crossed to, once it has eased there', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(360) });
    fireEvent.touchMove(strip.viewport, { touches: at(340) });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.touchMove(strip.viewport, { touches: at(60) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(60) });

    // Easing across, and nothing has moved yet.
    expect(strip.offset()).toBe(-WIDTH);
    expect(strip.easing()).toBe(true);
    expect(strip.onCommit).not.toHaveBeenCalled();

    act(() => vi.runAllTimers());
    expect(strip.onCommit).toHaveBeenCalledExactlyOnceWith(1);
    expect(strip.at()).toBe('1');
    // Back on its middle panel, which is now the month it moved to.
    expect(strip.offset()).toBe(0);
    expect(strip.easing()).toBe(false);
  });

  it('moves the other way for a drag the other way', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(60) });
    fireEvent.touchMove(strip.viewport, { touches: at(80) });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.touchMove(strip.viewport, { touches: at(360) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(360) });
    act(() => vi.runAllTimers());

    expect(strip.onCommit).toHaveBeenCalledExactlyOnceWith(-1);
    expect(strip.at()).toBe('-1');
  });

  it('takes a flick, short as it is', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(300) });
    fireEvent.touchMove(strip.viewport, { touches: at(280) });
    // Far less than a panel, but gone in a moment.
    act(() => vi.advanceTimersByTime(40));
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(220) });
    act(() => vi.runAllTimers());

    expect(strip.onCommit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('stays where it landed until the panels have moved under it', () => {
    // A caller that never moves its panels: the strip must not sit off to one side for good.
    const strip = setup(false);

    fireEvent.touchStart(strip.viewport, { touches: at(360) });
    fireEvent.touchMove(strip.viewport, { touches: at(340) });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.touchMove(strip.viewport, { touches: at(60) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(60) });

    act(() => vi.advanceTimersByTime(240));
    expect(strip.onCommit).toHaveBeenCalledExactlyOnceWith(1);
    // Still showing the panel it arrived at, because nothing has moved under it yet.
    expect(strip.offset()).toBe(-WIDTH);

    act(() => vi.runAllTimers());
    expect(strip.offset()).toBe(0);
  });

  it('steps straight to a neighbour for a button, without easing anywhere', () => {
    const strip = setup();

    fireEvent.click(screen.getByTestId('step-forward'));

    expect(strip.onCommit).toHaveBeenCalledExactlyOnceWith(1);
    expect(strip.at()).toBe('1');
    expect(strip.offset()).toBe(0);
    expect(strip.easing()).toBe(false);
  });

  it('ignores a pinch', () => {
    const strip = setup();

    fireEvent.touchStart(strip.viewport, { touches: at(300) });
    fireEvent.touchStart(strip.viewport, { touches: [...at(300), ...at(340, 340)] });
    fireEvent.touchMove(strip.viewport, { touches: at(60) });
    fireEvent.touchEnd(strip.viewport, { changedTouches: at(60) });
    act(() => vi.runAllTimers());

    expect(strip.offset()).toBe(0);
    expect(strip.onCommit).not.toHaveBeenCalled();
  });
});
