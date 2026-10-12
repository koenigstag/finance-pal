import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleViewport } from './visible-viewport';

// jsdom has no visual viewport: this stands in for one, with what a phone reports.
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;

  move(changes: { height?: number; offsetTop?: number }, event: 'resize' | 'scroll') {
    Object.assign(this, changes);
    this.dispatchEvent(new Event(event));
  }
}

describe('useVisibleViewport', () => {
  let viewport: FakeVisualViewport;

  beforeEach(() => {
    viewport = new FakeVisualViewport();
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has nothing covered while the whole page is in view', () => {
    const { result } = renderHook(() => useVisibleViewport());

    expect(result.current).toEqual({ inset: 0, height: 800 });
  });

  it('follows a keyboard drawn over the page, as on iOS', () => {
    const { result } = renderHook(() => useVisibleViewport());

    // The layout viewport keeps its height; only what's left to see shrinks.
    act(() => viewport.move({ height: 460 }, 'resize'));
    expect(result.current).toEqual({ inset: 340, height: 460 });

    act(() => viewport.move({ height: 800 }, 'resize'));
    expect(result.current).toEqual({ inset: 0, height: 800 });
  });

  it('counts what is in view scrolled up the page, as iOS does to show a field', () => {
    const { result } = renderHook(() => useVisibleViewport());

    act(() => viewport.move({ height: 460 }, 'resize'));
    act(() => viewport.move({ offsetTop: 120 }, 'scroll'));

    // The keyboard now covers less of the layout viewport's bottom: what is above it is lower.
    expect(result.current).toEqual({ inset: 220, height: 460 });
  });

  it('has nothing covered where the keyboard resizes the page, as on Android', () => {
    const { result } = renderHook(() => useVisibleViewport());

    vi.stubGlobal('innerHeight', 460);
    act(() => viewport.move({ height: 460 }, 'resize'));

    expect(result.current).toEqual({ inset: 0, height: 460 });
  });

  it('says nothing where the browser has no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);

    const { result } = renderHook(() => useVisibleViewport());

    expect(result.current).toBeNull();
  });

  it('stops listening once unmounted', () => {
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const { unmount } = renderHook(() => useVisibleViewport());

    unmount();

    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
