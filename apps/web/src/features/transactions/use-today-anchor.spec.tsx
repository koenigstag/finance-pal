import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTodayAnchor } from './use-today-anchor';

// jsdom lays nothing out, so the list is laid out here: a scroller VIEWPORT tall over `content`
// pixels of rows, the separator `anchor` pixels down them, and below the rows whatever spacer the
// hook asks for. A scroll past the end stops at the end, as a browser's does.
const VIEWPORT = 600;
// The hook leaves this much room above the separator.
const GAP = 8;

interface ListProps {
  selection: string;
  ready?: boolean;
  content?: number;
  // Null when nothing is planned, so there's no separator.
  anchor?: number | null;
}

function List({ selection, ready = true, content = 3000, anchor = 1200 }: ListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const spacer = useTodayAnchor(ref, selection, ready);
  return (
    <div ref={ref} data-testid="scroller" data-content={ready ? content : 0}>
      {ready && anchor !== null && <div data-today-anchor data-offset={anchor} />}
      {spacer > 0 && <div data-testid="spacer" style={{ height: spacer }} />}
    </div>
  );
}

const scroller = () => screen.getByTestId('scroller');
const spacer = () => parseFloat(screen.queryByTestId('spacer')?.style.height ?? '0');
// The user scrolling the list, or the browser moving it.
const scrollTo = (top: number) => fireEvent.scroll(scroller(), { target: { scrollTop: top } });
// A frame at a time, each in its own act: React renders between frames, as it does in a browser.
const frames = (count = 12) => {
  for (let index = 0; index < count; index++) {
    act(() => {
      vi.advanceTimersToNextFrame();
    });
  }
};

// React's development double-run of effects included: the app runs in StrictMode.
for (const { mode, wrapper } of [
  { mode: '', wrapper: undefined },
  { mode: ' in strict mode', wrapper: StrictMode },
]) {
  describe(`useTodayAnchor${mode}`, () => {
    // Each test its own selections: where lists were left is remembered for as long as the app runs.
    const selection = (name: string) => `${name}${mode}`;
    const show = (props: ListProps) => render(<List {...props} />, { wrapper });

    const original = Element.prototype.getBoundingClientRect;
    beforeAll(() => {
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const offset = this instanceof HTMLElement ? this.dataset.offset : undefined;
        const list = this.closest<HTMLElement>('[data-testid="scroller"]');
        const top = offset !== undefined && list ? Number(offset) - list.scrollTop : 0;
        return { top, bottom: top, left: 0, right: 0, height: 0, width: 0, x: 0, y: top } as DOMRect;
      };
      HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
        const top = typeof options === 'object' ? (options.top ?? 0) : 0;
        const height = Number(this.dataset.content ?? 0) + spacer();
        const next = Math.max(0, Math.min(top, height - VIEWPORT));
        if (next !== this.scrollTop) {
          this.scrollTop = next;
          this.dispatchEvent(new Event('scroll'));
        }
      } as HTMLElement['scrollTo'];
    });
    afterAll(() => {
      Element.prototype.getBoundingClientRect = original;
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens a list on the separator before what already happened', () => {
      show({ selection: selection('opens') });
      frames();
      expect(scroller().scrollTop).toBe(1200 - GAP);
    });

    it('opens one with nothing planned at the top', () => {
      show({ selection: selection('top'), anchor: null });
      frames();
      expect(scroller().scrollTop).toBe(0);
    });

    it("leaves a list alone as it refetches or loads more, wherever it's been scrolled to", () => {
      const list = show({ selection: selection('stays') });
      frames();
      scrollTo(2000);
      list.rerender(<List selection={selection('stays')} content={6000} />);
      frames();
      expect(scroller().scrollTop).toBe(2000);
    });

    it('comes back where it was left, after the page was left for another tab', () => {
      const first = show({ selection: selection('back') });
      frames();
      scrollTo(2000);
      first.unmount();

      // Its pages still loaded, the list is ready as soon as it's shown again.
      show({ selection: selection('back') });
      frames();
      expect(scroller().scrollTop).toBe(2000);
    });

    it('comes back to the top too, if that is where it was left', () => {
      const first = show({ selection: selection('back-top') });
      frames();
      scrollTo(0);
      first.unmount();

      show({ selection: selection('back-top') });
      frames();
      expect(scroller().scrollTop).toBe(0);
    });

    it('starts on today again when the list has to load anew', () => {
      const first = show({ selection: selection('reloads') });
      frames();
      scrollTo(2000);
      first.unmount();

      const second = show({ selection: selection('reloads'), ready: false });
      second.rerender(<List selection={selection('reloads')} />);
      frames();
      expect(scroller().scrollTop).toBe(1200 - GAP);

      // And that's where it's found next time, not where it was before it loaded again.
      second.unmount();
      show({ selection: selection('reloads') });
      frames();
      expect(scroller().scrollTop).toBe(1200 - GAP);
    });

    it('keeps where each selection was left apart', () => {
      const list = show({ selection: selection('all') });
      frames();
      scrollTo(2000);

      list.rerender(<List selection={selection('filtered')} ready={false} />);
      // Emptied while the other selection loads, the list can't stay scrolled that far down.
      scrollTo(0);
      list.rerender(<List selection={selection('filtered')} />);
      frames();
      expect(scroller().scrollTop).toBe(1200 - GAP);

      list.rerender(<List selection={selection('all')} />);
      frames();
      expect(scroller().scrollTop).toBe(2000);
    });

    it('makes room below the rows again when where it was left needs it', () => {
      // 1500 pixels of rows scroll 900 at most: putting the separator at the top takes a spacer.
      const first = show({ selection: selection('room'), content: 1500 });
      frames();
      expect(scroller().scrollTop).toBe(1200 - GAP);
      expect(spacer()).toBe(1200 - GAP - 900);
      scrollTo(1100);
      first.unmount();

      show({ selection: selection('room'), content: 1500 });
      frames();
      expect(scroller().scrollTop).toBe(1100);
      expect(spacer()).toBe(1100 - 900);
    });
  });
}
