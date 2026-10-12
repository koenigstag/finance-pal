import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { OverviewDay } from './overview-model';

// The plot's height, the room above it for the top gridline's label, and below it for the days.
const PLOT_HEIGHT = 160;
const PLOT_TOP = 8;
const AXIS_HEIGHT = 20;
const HEIGHT = PLOT_TOP + PLOT_HEIGHT + AXIS_HEIGHT;
// Bars stay thin however wide the window: what the slot has left over is air.
const MAX_BAR_WIDTH = 24;
// Rounded where the data ends, square on the baseline.
const BAR_RADIUS = 2;
// A day with very little still shows as something next to one with a lot.
const MIN_BAR_HEIGHT = 2;
// The days a label goes under; the rest are read off their neighbours.
const LABELED_DAYS = [1, 5, 10, 15, 20, 25, 30];
// How many of a day's parts its readout lists before folding the rest into a count.
const READOUT_PARTS = 5;
const READOUT_WIDTH = 232;

interface DailyChartProps {
  days: OverviewDay[];
  // The first of the month.
  month: Date;
  // Today's day of the month, when the month is this one.
  today: number | null;
  colorOf: (key: string) => string;
  nameOf: (key: string) => string;
  money: (amount: string) => string;
  label: string;
}

/**
 * A month's money a column per day, each split into what it went on, in their colors. Pointing at a
 * day (or tapping it, on a touch screen) reads out what it was. The rows under the chart carry the
 * same money in words, so nothing here depends on telling colors apart.
 */
export function DailyChart({ days, month, today, colorOf, nameOf, money, label }: DailyChartProps) {
  const { i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  // An id SVG's url(#…) can name as it is.
  const clipPrefix = `bars${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // A mouse points; a finger picks, and picks again to let go.
  const [hovered, setHovered] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const active = hovered ?? picked;

  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
  const ticks = niceTicks(Math.max(0, ...days.map((day) => Number(day.total))));
  const top = ticks[ticks.length - 1];
  const tickLabels = ticks.map((tick) => compact.format(tick));
  // Wide enough for the longest label at the axis' font size.
  const gutter = Math.max(24, Math.max(...tickLabels.map((text) => text.length)) * 6 + 8);
  const slot = (width - gutter) / days.length;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(2, slot * 0.7));
  const baseline = PLOT_TOP + PLOT_HEIGHT;
  const scale = (value: number) => (value / top) * PLOT_HEIGHT;
  const center = (day: number) => gutter + slot * (day - 0.5);
  // Today's day gets a label wherever it falls; a regular one too close to it gives way.
  const labelApart = Math.ceil(18 / slot);
  const labeled = (day: number) =>
    day === today || (LABELED_DAYS.includes(day) && (today === null || Math.abs(day - today) >= labelApart));

  const activeDay = active === null ? undefined : days[active - 1];
  const readoutLeft =
    activeDay === undefined
      ? 0
      : // Beside the column rather than over it, on whichever side has the room.
        center(activeDay.day) > width / 2
        ? Math.max(0, center(activeDay.day) - barWidth / 2 - 8 - READOUT_WIDTH)
        : Math.max(0, Math.min(width - READOUT_WIDTH, center(activeDay.day) + barWidth / 2 + 8));

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setHovered(null)}>
      <svg role="img" aria-label={label} width={width} height={HEIGHT} className="block overflow-visible select-none">
        {ticks.map((tick, index) => {
          const y = Math.round(baseline - scale(tick)) + 0.5;
          return (
            <g key={tick}>
              <line x1={gutter} x2={width} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text x={gutter - 6} y={y} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {tickLabels[index]}
              </text>
            </g>
          );
        })}

        {days.map((day) => {
          const raw = scale(Number(day.total));
          if (raw <= 0) {
            return null;
          }
          const height = Math.max(MIN_BAR_HEIGHT, raw);
          const stretch = height / raw;
          const x = center(day.day) - barWidth / 2;
          const clipId = `${clipPrefix}-${day.day}`;
          let bottom = baseline;
          return (
            <g key={day.day} className={cn('transition-opacity', active !== null && active !== day.day && 'opacity-35')}>
              <defs>
                {/* Reaching past the baseline, so only the top corners come out round. */}
                <clipPath id={clipId}>
                  <rect x={x} y={baseline - height} width={barWidth} height={height + BAR_RADIUS} rx={BAR_RADIUS} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                {day.parts.map((part, index) => {
                  const partHeight = scale(Number(part.amount)) * stretch;
                  const y = bottom - partHeight;
                  bottom = y;
                  // A hairline of the page between one part and the one under it, so neighbours
                  // of the same color still read as two.
                  const gap = index > 0 && partHeight > 1.5 ? 1 : 0;
                  return (
                    <rect key={part.key} x={x} y={y} width={barWidth} height={partHeight - gap} fill={colorOf(part.key)} />
                  );
                })}
              </g>
            </g>
          );
        })}

        {days.map((day) =>
          labeled(day.day) ? (
            <text
              key={day.day}
              x={center(day.day)}
              y={baseline + AXIS_HEIGHT - 4}
              textAnchor="middle"
              className={cn('text-[11px] tabular-nums', day.day === today ? 'fill-foreground font-semibold' : 'fill-muted-foreground')}
            >
              {day.day}
            </text>
          ) : null,
        )}

        {/* Hit areas a whole slot wide and the plot's height, bigger than any bar. */}
        {days.map((day) => (
          <rect
            key={day.day}
            x={gutter + slot * (day.day - 1)}
            y={PLOT_TOP}
            width={slot}
            height={PLOT_HEIGHT}
            fill="transparent"
            onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(day.day)}
            onClick={() => setPicked((current) => (current === day.day ? null : day.day))}
          />
        ))}
      </svg>

      {activeDay && (
        <div
          className="pointer-events-none absolute top-0 flex flex-col gap-1 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
          style={{ left: readoutLeft, width: Math.min(READOUT_WIDTH, width) }}
        >
          <p className="text-muted-foreground">
            {new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long' }).format(
              new Date(month.getFullYear(), month.getMonth(), activeDay.day),
            )}
          </p>
          <p className="font-medium tabular-nums">{money(activeDay.total)}</p>
          {activeDay.parts.slice(0, READOUT_PARTS).map((part) => (
            <div key={part.key} className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(part.key) }} />
              <span className="min-w-0 flex-1 truncate">{nameOf(part.key)}</span>
              <span className="whitespace-nowrap tabular-nums">{money(part.amount)}</span>
            </div>
          ))}
          {activeDay.parts.length > READOUT_PARTS && <DayMore count={activeDay.parts.length - READOUT_PARTS} />}
        </div>
      )}
    </div>
  );
}

function DayMore({ count }: { count: number }) {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t('overview.dayMore', { count })}</p>;
}

/**
 * Round steps from zero up past `max`: three or four gridlines at 1, 2, 2.5 or 5 times a power of
 * ten. A month with nothing still gets an axis.
 */
export function niceTicks(max: number): number[] {
  if (max <= 0) {
    return [0, 1];
  }
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= rough) ?? 10) * power;
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) {
    ticks.push(ticks.length * step);
  }
  return ticks;
}

// The element's width, kept up to date as the window or the layout changes. A guess until it's
// measured (and in tests, which lay nothing out).
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      if (element.clientWidth > 0) {
        setWidth(element.clientWidth);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
