import { addDays, addMonths, format, isSameMonth, parse, startOfMonth, startOfWeek, type Day } from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSwipe } from '@/lib/swipe';
import { capitalizeFirst } from '@/lib/text';
import { cn } from '@/lib/utils';

// A day as the forms hold it.
const DAY_FORMAT = 'yyyy-MM-dd';
// Six weeks, always: every month fits, and the grid keeps its height from one month to the next.
const GRID_DAYS = 42;

interface MonthCalendarProps {
  // The chosen day, yyyy-MM-dd.
  value: string;
  onChange: (day: string) => void;
  // 0 = Sunday … 6 = Saturday, as the profile keeps it.
  weekStartsOn: number;
  // The earliest day that can be chosen, yyyy-MM-dd; earlier ones show but can't be picked.
  min?: string;
  locale: string;
  labels: { previousMonth: string; nextMonth: string };
}

/** A month of days to pick one from, with the months before and after a tap — or a swipe — away. */
export function MonthCalendar({ value, onChange, weekStartsOn, min, locale, labels }: MonthCalendarProps) {
  const [month, setMonth] = useState(() => startOfMonth(parse(value, DAY_FORMAT, new Date())));
  const goToMonth = (delta: number) => setMonth((current) => addMonths(current, delta));
  // The same gesture as on the transactions list: left for the month before, right for the one
  // after, the way the chevrons above the grid sit.
  const swipe = useSwipe((direction) => goToMonth(direction === 'left' ? -1 : 1));
  // A value set from outside (the sheet opening on another transaction) brings its month along.
  useEffect(() => {
    setMonth(startOfMonth(parse(value, DAY_FORMAT, new Date())));
  }, [value]);

  const days = useMemo(() => {
    const first = startOfWeek(month, { weekStartsOn: weekStartsOn as Day });
    return Array.from({ length: GRID_DAYS }, (_, index) => addDays(first, index));
  }, [month, weekStartsOn]);
  const today = format(new Date(), DAY_FORMAT);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const fullDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const title = capitalizeFirst(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month), locale);

  return (
    <div {...swipe} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label={labels.previousMonth} onClick={() => goToMonth(-1)}>
          <ChevronLeftIcon />
        </Button>
        <span aria-live="polite" className="font-medium">
          {title}
        </span>
        <Button variant="ghost" size="icon" aria-label={labels.nextMonth} onClick={() => goToMonth(1)}>
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-7 place-items-center gap-y-0.5">
        {days.slice(0, 7).map((day) => (
          <span key={day.getDay()} aria-hidden className="py-1 text-xs text-muted-foreground">
            {weekday.format(day)}
          </span>
        ))}
        {days.map((day) => {
          const key = format(day, DAY_FORMAT);
          const selected = key === value;
          const disabled = min !== undefined && key < min;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={fullDay.format(day)}
              onClick={() => onChange(key)}
              className={cn(
                'flex size-10 items-center justify-center rounded-full text-sm tabular-nums transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                // The neighbouring months' days fill the grid, quieter.
                !isSameMonth(day, month) && 'text-muted-foreground/60',
                key === today && !selected && 'font-semibold text-primary ring-1 ring-primary/40',
                selected ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
                disabled && 'pointer-events-none opacity-30',
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
