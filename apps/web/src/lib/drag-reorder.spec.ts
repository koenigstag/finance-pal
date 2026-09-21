import { describe, expect, it } from 'vitest';
import { targetIndex, type RowBox } from './drag-reorder';

// Four rows of 40px, one under the other, their middles at 20, 60, 100 and 140.
const rows: RowBox[] = [0, 40, 80, 120].map((top) => ({ top, height: 40 }));

describe('targetIndex', () => {
  it('keeps a row where it is until it passes the middle of its neighbour', () => {
    expect(targetIndex(rows, 0, 0)).toBe(0);
    expect(targetIndex(rows, 0, 39)).toBe(0);
    expect(targetIndex(rows, 0, 41)).toBe(1);
  });

  it('counts every neighbour a row is carried past, in both directions', () => {
    expect(targetIndex(rows, 0, 100)).toBe(2);
    expect(targetIndex(rows, 3, -100)).toBe(1);
  });

  it('stops at the ends of the list', () => {
    expect(targetIndex(rows, 0, -500)).toBe(0);
    expect(targetIndex(rows, 0, 500)).toBe(3);
  });

  it('measures rows as they are, not as if they were all the same height', () => {
    const uneven: RowBox[] = [
      { top: 0, height: 40 },
      { top: 40, height: 200 },
      { top: 240, height: 40 },
    ];
    // The tall row's middle is 140px down, so the first row has to travel that far to pass it.
    expect(targetIndex(uneven, 0, 100)).toBe(0);
    expect(targetIndex(uneven, 0, 130)).toBe(1);
  });
});
