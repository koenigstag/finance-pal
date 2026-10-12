import { CheckIcon, DeleteIcon } from 'lucide-react';
import { cn } from 'cn';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  displayFormula,
  evaluateFormula,
  formulaAmount,
  pressKey,
  type CalculatorError,
  type CalculatorKey,
} from '@/lib/calculator';
import { isValidAmountInput, parseMoneyInput } from '@/lib/money';

// The keypad, row by row; '=' turns into a tick once there's a single number to hand over.
const KEYPAD: (CalculatorKey | 'clear' | 'equals')[][] = [
  ['clear', '(', ')', '/'],
  ['7', '8', '9', '*'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['%', '0', ',', 'equals'],
];
const KEYS = new Set<string>(KEYPAD.flat().filter((key) => key !== 'clear' && key !== 'equals'));
const GLYPHS: Partial<Record<CalculatorKey, string>> = { '/': '÷', '*': '×', '-': '−' };
// What a screen reader calls the keys that aren't digits.
const NAMES = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '%': 'percent',
  ',': 'decimal',
  '(': 'openBracket',
  ')': 'closeBracket',
} as const;
const isNamed = (key: CalculatorKey): key is keyof typeof NAMES => key in NAMES;

interface CalculatorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // What the field holds, to go on from. Read once, when it mounts: the amount sheet gives it a new
  // key for each opening.
  value: string;
  // The number the formula came to, as an amount ("1234.5"), for the field.
  onDone: (amount: string) => void;
}

/**
 * A calculator for an amount field, opened from the button in it. The formula is typed in full and
 * only worked out on "=", into a single number without its sign — an amount has none; with nothing
 * left to work out, "=" becomes a tick that puts that number in the field.
 */
export function CalculatorSheet({ open, onOpenChange, value, onDone }: CalculatorSheetProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  // Goes on from the amount there is; "0", which a new one starts at, is nothing to go on from.
  const [formula, setFormula] = useState(() => (isValidAmountInput(value) ? (parseMoneyInput(value) ?? '').replace('.', ',') : ''));
  // A number that's an answer — the field's, or what "=" came to — rather than one being typed: an
  // operation carries on from it, a new number takes its place.
  const [answer, setAnswer] = useState(formula !== '');
  const [error, setError] = useState<CalculatorError | null>(null);
  const amount = formulaAmount(formula);

  const press = (key: CalculatorKey) => {
    const startsNumber = /[\d,(]/.test(key);
    setFormula(pressKey(answer && startsNumber ? '' : formula, key));
    setAnswer(false);
    setError(null);
  };
  const erase = () => {
    setFormula(formula.slice(0, -1));
    setAnswer(false);
    setError(null);
  };
  const clear = () => {
    setFormula('');
    setAnswer(false);
    setError(null);
  };
  const equals = () => {
    if (amount !== null) {
      onDone(amount);
      onOpenChange(false);
      return;
    }
    if (!formula) {
      return;
    }
    const result = evaluateFormula(formula);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setFormula(result.formula);
    setAnswer(true);
    setError(null);
  };

  // Typed on a keyboard as well, where there is one: "." for the comma, Enter for "=".
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const key = event.key === '.' ? ',' : event.key;
    if (KEYS.has(key)) {
      press(key as CalculatorKey);
    } else if (key === 'Enter' || key === '=') {
      equals();
    } else if (key === 'Backspace') {
      erase();
    } else if (key === 'Delete') {
      clear();
    } else {
      return;
    }
    // Enter would otherwise also press whichever key has the focus.
    event.preventDefault();
  };

  const shown = displayFormula(formula);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
        // On the sheet itself rather than its first key, which would look pressed.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('transactions.calculator.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex items-end gap-1 rounded-lg bg-muted/50 py-2 pr-1 pl-3">
          <div className="min-w-0 flex-1 py-1 text-right">
            <output
              aria-live="polite"
              className={cn(
                'block min-h-10 font-medium tabular-nums wrap-anywhere',
                // Smaller as it grows, so a long formula still fits in a line or two.
                shown.length > 18 ? 'text-2xl' : shown.length > 10 ? 'text-3xl' : 'text-4xl',
              )}
            >
              {formula ? shown : <span className="text-muted-foreground">0</span>}
            </output>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(`transactions.calculator.errors.${error}`)}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={t('transactions.calculator.erase')}
            disabled={!formula}
            onClick={erase}
          >
            <DeleteIcon className="size-5" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {KEYPAD.flat().map((key) => {
            const keyClass = 'h-14 text-xl md:h-12';
            if (key === 'clear') {
              return (
                <Button
                  key={key}
                  type="button"
                  variant="secondary"
                  className={cn(keyClass, 'text-destructive')}
                  aria-label={t('transactions.calculator.clear')}
                  onClick={clear}
                >
                  C
                </Button>
              );
            }
            if (key === 'equals') {
              return (
                <Button
                  key={key}
                  type="button"
                  className={keyClass}
                  aria-label={t(amount !== null ? 'transactions.calculator.done' : 'transactions.calculator.equals')}
                  disabled={!formula}
                  onClick={equals}
                >
                  {amount !== null ? <CheckIcon className="size-6" /> : '='}
                </Button>
              );
            }
            return (
              <Button
                key={key}
                type="button"
                variant={/\d|,/.test(key) ? 'outline' : 'secondary'}
                className={keyClass}
                aria-label={isNamed(key) ? t(`transactions.calculator.${NAMES[key]}`) : undefined}
                onClick={() => press(key)}
              >
                {GLYPHS[key] ?? key}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
