import { MinusIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonthCalendar } from '@/components/month-calendar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldDescription } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useProfile } from '@/features/profile/queries';
import { todayInput } from '@/lib/dates';
import { formatDay, lastPaymentDay, parseRepeatKey, repeatChoices, toRepeatKey, useRepeatLabel, type Repeat } from './repeat';

// The chips' value for "never": a toggle group reports '' when its item is tapped off.
const NEVER = 'never';

// How a series ends: never, on a day picked from a calendar, or after so many payments — kept, like
// the day, as the date its last payment falls on.
type EndMode = 'never' | 'date' | 'count';
const END_MODES: readonly EndMode[] = ['never', 'date', 'count'];
// What "After N times" starts at: a year of a monthly series.
const DEFAULT_PAYMENTS = 12;
const MAX_PAYMENTS = 999;

export interface DateChoice {
  // yyyy-MM-dd.
  day: string;
  // As toRepeatKey writes it; '' for no repeat.
  repeat: string;
  // A series' last day, yyyy-MM-dd; '' for one that never ends.
  endsOn: string;
}

interface DateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // "Date", or "Next date" for a series.
  title: string;
  value: DateChoice;
  // Whether it can repeat here at all: a transaction already recorded changes alone, so it can't.
  canRepeat: boolean;
  // Why it can't repeat although it otherwise could (a transfer between currencies), in place of
  // the choices.
  repeatBlocked?: string;
  // A series' own repeat, kept among the choices even if it's none of the presets.
  currentRepeat?: Repeat | null;
  // A series' first ever payment day, which its payments are counted from while its schedule stays.
  anchorDay?: string;
  // The earliest day on offer, yyyy-MM-dd.
  minDay?: string;
  // A new series dated in the past records every date since: say so while that's chosen.
  warnsOfPastDates?: boolean;
  // While the choice is being saved, and what went wrong if it wasn't.
  pending?: boolean;
  error?: string;
  onDone: (choice: DateChoice) => void;
}

/**
 * When a transaction happens: a day from a calendar and, where it can, how often it repeats. The
 * choice is only handed over with Done, so closing the sheet leaves things as they were.
 */
export function DateSheet({
  open,
  onOpenChange,
  title,
  value,
  canRepeat,
  repeatBlocked,
  currentRepeat,
  anchorDay,
  minDay,
  warnsOfPastDates,
  pending,
  error,
  onDone,
}: DateSheetProps) {
  const { t, i18n } = useTranslation();
  const profile = useProfile();
  const repeatLabel = useRepeatLabel();
  const [day, setDay] = useState(value.day);
  const [repeat, setRepeat] = useState(value.repeat);
  const [endMode, setEndMode] = useState<EndMode>(value.endsOn ? 'date' : 'never');
  const [endDay, setEndDay] = useState(value.endsOn);
  const [payments, setPayments] = useState(DEFAULT_PAYMENTS);

  // Every opening starts from what's set now, not from what the last visit left unsaved.
  useEffect(() => {
    if (open) {
      setDay(value.day);
      setRepeat(value.repeat);
      setEndMode(value.endsOn ? 'date' : 'never');
      setEndDay(value.endsOn);
      setPayments(DEFAULT_PAYMENTS);
    }
  }, [open, value.day, value.repeat, value.endsOn]);

  const repeats = parseRepeatKey(repeat);
  // Counted from the series' own first payment while its schedule stays, as the API counts; from the
  // day picked once it starts afresh there.
  const anchor = anchorDay && day === value.day && repeat === value.repeat ? anchorDay : day;
  const countedEnd = repeats ? lastPaymentDay(anchor, repeats, day, payments) : '';
  const lastDay = !repeats || endMode === 'never' ? '' : endMode === 'count' ? countedEnd : endDay < day ? day : endDay;
  const chooseEndMode = (mode: EndMode) => {
    setEndMode(mode);
    // A calendar opening on the day a year of payments would come to, rather than on nothing.
    if (mode === 'date' && (!endDay || endDay < day) && repeats) {
      setEndDay(lastPaymentDay(anchor, repeats, day, DEFAULT_PAYMENTS));
    }
  };

  const backfillFrom = warnsOfPastDates && repeat && day < todayInput() ? day : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
          <MonthCalendar
            value={day}
            onChange={setDay}
            weekStartsOn={profile.data?.startDayOfWeek ?? 1}
            min={minDay}
            locale={i18n.language}
            labels={{ previousMonth: t('transactions.dateSheet.previousMonth'), nextMonth: t('transactions.dateSheet.nextMonth') }}
          />
          {canRepeat && (
            <section aria-labelledby="date-sheet-repeat" className="flex flex-col gap-2">
              <h3 id="date-sheet-repeat" className="text-sm font-medium">
                {t('transactions.repeat.label')}
              </h3>
              {repeatBlocked ? (
                <p className="text-sm text-muted-foreground">{repeatBlocked}</p>
              ) : (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="w-full flex-wrap justify-start"
                  aria-labelledby="date-sheet-repeat"
                  value={repeat || NEVER}
                  onValueChange={(next) => next && setRepeat(next === NEVER ? '' : next)}
                >
                  {[null, ...repeatChoices(currentRepeat ?? null)].map((choice) => (
                    <ToggleGroupItem
                      key={toRepeatKey(choice) || NEVER}
                      value={toRepeatKey(choice) || NEVER}
                      className="rounded-full data-[state=on]:border-foreground/60"
                    >
                      {choice ? repeatLabel(choice) : t('transactions.repeat.never')}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              {backfillFrom && (
                <FieldDescription>
                  {t('transactions.repeat.backfill', {
                    date: new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(
                      new Date(`${backfillFrom}T00:00`),
                    ),
                  })}
                </FieldDescription>
              )}
            </section>
          )}
          {canRepeat && !repeatBlocked && repeats && (
            <section aria-labelledby="date-sheet-ends" className="flex flex-col gap-2">
              <h3 id="date-sheet-ends" className="text-sm font-medium">
                {t('transactions.ends.label')}
              </h3>
              <ToggleGroup
                type="single"
                variant="outline"
                className="w-full flex-wrap justify-start"
                aria-labelledby="date-sheet-ends"
                value={endMode}
                onValueChange={(next) => next && chooseEndMode(next as EndMode)}
              >
                {END_MODES.map((mode) => (
                  <ToggleGroupItem key={mode} value={mode} className="rounded-full data-[state=on]:border-foreground/60">
                    {t(mode === 'never' ? 'transactions.ends.never' : mode === 'date' ? 'transactions.ends.onDate' : 'transactions.ends.afterCount')}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {endMode === 'date' && (
                <MonthCalendar
                  value={lastDay}
                  onChange={setEndDay}
                  weekStartsOn={profile.data?.startDayOfWeek ?? 1}
                  min={day}
                  locale={i18n.language}
                  labels={{ previousMonth: t('transactions.dateSheet.previousMonth'), nextMonth: t('transactions.dateSheet.nextMonth') }}
                />
              )}
              {endMode === 'count' && (
                <div className="flex items-center justify-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('transactions.ends.fewer')}
                    disabled={payments <= 1}
                    onClick={() => setPayments((count) => Math.max(1, count - 1))}
                  >
                    <MinusIcon />
                  </Button>
                  <span className="min-w-28 text-center font-medium tabular-nums" aria-live="polite">
                    {t('transactions.ends.payments', { count: payments })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('transactions.ends.more')}
                    disabled={payments >= MAX_PAYMENTS}
                    onClick={() => setPayments((count) => Math.min(MAX_PAYMENTS, count + 1))}
                  >
                    <PlusIcon />
                  </Button>
                </div>
              )}
              {lastDay && <FieldDescription>{t('transactions.ends.lastPayment', { date: formatDay(lastDay, i18n.language) })}</FieldDescription>}
            </section>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={() => onDone({ day, repeat, endsOn: lastDay })}>
            {pending && <Spinner />}
            {t('transactions.dateSheet.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
