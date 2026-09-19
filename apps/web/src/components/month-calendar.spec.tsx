import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthCalendar } from './month-calendar';

const labels = { previousMonth: 'Previous month', nextMonth: 'Next month' };

const setup = () => {
  const { container } = render(
    <MonthCalendar value="2026-09-15" onChange={vi.fn()} weekStartsOn={1} locale="en-GB" labels={labels} />,
  );
  return container.firstElementChild as HTMLElement;
};

const swipe = (element: HTMLElement, from: number, to: number) => {
  fireEvent.touchStart(element, { touches: [{ clientX: from, clientY: 200 }] });
  fireEvent.touchMove(element, { touches: [{ clientX: (from + to) / 2, clientY: 204 }] });
  fireEvent.touchEnd(element, { changedTouches: [{ clientX: to, clientY: 208 }] });
};

describe('MonthCalendar', () => {
  it('swipes left to the month before and right to the one after', () => {
    const calendar = setup();
    expect(screen.getByText('September 2026')).toBeTruthy();

    swipe(calendar, 240, 100);
    expect(screen.getByText('August 2026')).toBeTruthy();

    swipe(calendar, 100, 240);
    swipe(calendar, 100, 240);
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('stays on its month while a finger goes up and down', () => {
    const calendar = setup();

    fireEvent.touchStart(calendar, { touches: [{ clientX: 240, clientY: 400 }] });
    fireEvent.touchMove(calendar, { touches: [{ clientX: 230, clientY: 200 }] });
    fireEvent.touchEnd(calendar, { changedTouches: [{ clientX: 100, clientY: 400 }] });

    expect(screen.getByText('September 2026')).toBeTruthy();
  });

  it('still steps a month at a time from the chevrons', () => {
    setup();

    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('August 2026')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Next month'));
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });
});
