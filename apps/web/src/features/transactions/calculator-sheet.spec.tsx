import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { CalculatorSheet } from './calculator-sheet';

const open = (value = '') => {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(<CalculatorSheet open onOpenChange={onOpenChange} value={value} onDone={onDone} />);
  return { onDone, onOpenChange };
};

// Presses keypad keys by what they show, or by name where the key is an icon or a sign.
const press = (...keys: string[]) => {
  for (const key of keys) {
    fireEvent.click(screen.getByRole('button', { name: key }));
  }
};
const shown = () => screen.getByRole('status').textContent;

describe('CalculatorSheet', () => {
  it('works the formula out on "=" only, then hands over the number on the tick', () => {
    const { onDone, onOpenChange } = open();

    press('1', '2', 'Plus', '3', 'Multiply by', '4');
    // Typed, not worked out: there's still something to do.
    expect(shown()).toBe('12 + 3 × 4');
    expect(screen.queryByRole('button', { name: 'Use this amount' })).toBeNull();

    press('Equals');
    expect(shown()).toBe('24');
    expect(onDone).not.toHaveBeenCalled();

    press('Use this amount');
    expect(onDone).toHaveBeenCalledWith('24');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hands over what a negative result comes to without its sign', () => {
    const { onDone } = open();

    press('3', '0', 'Minus', '5', '0', 'Equals');
    expect(shown()).toBe('20');

    press('Use this amount');
    expect(onDone).toHaveBeenCalledWith('20');
  });

  it('goes on from the amount in the field, which a new number replaces', () => {
    open('12.50');
    expect(shown()).toBe('12,50');
    // A single number already: nothing to work out.
    expect(screen.getByRole('button', { name: 'Use this amount' })).toBeTruthy();

    press('Plus', '1', 'Decimal comma', '5');
    expect(shown()).toBe('12,50 + 1,5');

    press('Equals', '7');
    expect(shown()).toBe('7');
  });

  it('starts empty from a field that holds nothing yet', () => {
    open('0');

    expect(shown()).toBe('0');
    expect(screen.getByRole('button', { name: 'Equals' }).hasAttribute('disabled')).toBe(true);
  });

  it('says what keeps a formula from working out, and keeps it to fix', () => {
    open();

    press('5', 'Divide by', '0', 'Equals');
    expect(screen.getByRole('alert').textContent).toBe("Can't divide by zero");
    expect(shown()).toBe('5 ÷ 0');

    press('Erase', '2');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(shown()).toBe('5 ÷ 2');
  });

  it('takes a percentage of what it is added to, with brackets and the comma', () => {
    const { onDone } = open();

    press('Opening bracket', '1', '0', '0', 'Plus', '1', '0', '0', 'Closing bracket', 'Minus', '1', '0', 'Per cent');
    press('Equals', 'Use this amount');
    expect(onDone).toHaveBeenCalledWith('180');
  });

  it('types from a keyboard too', () => {
    const { onDone } = open();
    const sheet = screen.getByRole('dialog');

    for (const key of ['1', '0', '.', '5', '*', '2', 'Enter']) {
      fireEvent.keyDown(sheet, { key });
    }
    expect(shown()).toBe('21');

    fireEvent.keyDown(sheet, { key: 'Enter' });
    expect(onDone).toHaveBeenCalledWith('21');
  });
});
