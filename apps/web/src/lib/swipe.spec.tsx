import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { swipeDirection, useSwipe, type SwipeDirection } from './swipe';

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
