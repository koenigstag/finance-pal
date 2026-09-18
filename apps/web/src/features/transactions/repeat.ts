import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RECURRENCE_UNITS } from '@ft/shared-contracts';

type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

/** How often a series repeats: every `value` `unit`s. */
export interface Repeat {
  unit: RecurrenceUnit;
  value: number;
}

// What the form offers, in this order: 1Money's list, which people coming from it know, less its
// weekdays and weekends — a series here repeats every so many days, weeks, months or years.
export const REPEAT_PRESETS: readonly Repeat[] = [
  { unit: 'day', value: 1 },
  { unit: 'day', value: 2 },
  { unit: 'week', value: 1 },
  { unit: 'week', value: 2 },
  { unit: 'week', value: 4 },
  { unit: 'month', value: 1 },
  { unit: 'month', value: 2 },
  { unit: 'month', value: 3 },
  { unit: 'month', value: 6 },
  { unit: 'year', value: 1 },
];

export function repeatOf(rule: { intervalUnit: RecurrenceUnit; intervalValue: number }): Repeat {
  return { unit: rule.intervalUnit, value: rule.intervalValue };
}

/** A repeat as a form field holds it, e.g. "month:1"; '' stands for none. */
export function toRepeatKey(repeat: Repeat | null): string {
  return repeat ? `${repeat.unit}:${repeat.value}` : '';
}

/** The repeat a form field holds, or null for none (or anything that isn't one). */
export function parseRepeatKey(key: string): Repeat | null {
  const [unit, value] = key.split(':');
  const count = Number(value);
  const known = RECURRENCE_UNITS.find((candidate) => candidate === unit);
  return known && Number.isInteger(count) && count >= 1 ? { unit: known, value: count } : null;
}

/**
 * The choices for a series' repeat: the presets, plus the series' own when it's none of them (one
 * set through the API, say), so that opening it doesn't quietly change how often it repeats.
 */
export function repeatChoices(current: Repeat | null): readonly Repeat[] {
  if (!current || REPEAT_PRESETS.some((preset) => toRepeatKey(preset) === toRepeatKey(current))) {
    return REPEAT_PRESETS;
  }
  return [...REPEAT_PRESETS, current];
}

/** "Every month", "Every 2 weeks". */
export function useRepeatLabel(): (repeat: Repeat) => string {
  const { t } = useTranslation();
  return useCallback(
    (repeat: Repeat) =>
      // One of a unit reads without the number: "every day", not "every 1 day".
      repeat.value === 1
        ? t(`transactions.repeat.every.${repeat.unit}`)
        : t(`transactions.repeat.everyN.${repeat.unit}`, { count: repeat.value }),
    [t],
  );
}
