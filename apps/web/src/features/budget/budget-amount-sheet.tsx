import { CalculatorIcon } from 'lucide-react';
import { useEffect, useState, type FocusEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { CalculatorSheet } from '@/features/transactions/calculator-sheet';
import { isValidAmountInput, parseMoneyInput } from '@/lib/money';
import { targetName, type BudgetTarget } from './budget-model';
import { useSaveBudget, type Budget } from './queries';

const selectOnFocus = (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select();

interface BudgetAmountSheetProps {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: BudgetTarget;
  // The line whose amount is being changed; absent when adding one.
  line?: Budget;
  // YYYY-MM, for a new line.
  month: string;
  // The month as the page names it, under the title.
  monthLabel: string;
  // The signed-in person's: a category's amount is always typed in it.
  mainCurrencyId: number | undefined;
}

/**
 * How much goes to one line of the budget this month: typed, or worked out in the calculator. A
 * category's amount is in the main currency, an account's in the account's own.
 */
export function BudgetAmountSheet({
  groupId,
  open,
  onOpenChange,
  target,
  line,
  month,
  monthLabel,
  mainCurrencyId,
}: BudgetAmountSheetProps) {
  const { t } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const save = useSaveBudget(groupId);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  // Bumped each time the calculator opens, so it mounts fresh and goes on from the field.
  const [calculatorLayer, setCalculatorLayer] = useState(0);
  const [calculating, setCalculating] = useState(false);

  // Every opening starts from the line's amount, or empty for a new one.
  useEffect(() => {
    if (open) {
      setValue(line?.amount ?? '');
      setInvalid(false);
      save.reset();
    }
    // save.reset is stable; the sheet resets only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line]);

  const currencyId = target?.type === 'account' ? target.account.currencyId : mainCurrencyId;
  const code = currencyCodes.get(currencyId ?? -1) ?? '';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseMoneyInput(value);
    if (!target || amount === null || !isValidAmountInput(value)) {
      setInvalid(true);
      return;
    }
    const done = { onSuccess: () => onOpenChange(false) };
    if (line) {
      save.mutate({ budgetId: line.id, amount }, done);
    } else {
      const body = target.type === 'category' ? { month, categoryId: target.category.id, amount } : { month, accountId: target.account.id, amount };
      save.mutate({ body }, done);
    }
  };

  const appearance = target?.type === 'category' ? target.category : target?.account;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
        <DialogContent>
          {target && (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <DialogHeader>
                <div className="flex items-center gap-3 pr-8">
                  <AppearanceIcon
                    icon={appearance?.icon}
                    color={appearance?.color}
                    fallbackIcon={target.type === 'account' ? 'wallet' : undefined}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <DialogTitle className="truncate">{targetName(target)}</DialogTitle>
                    <DialogDescription className="truncate">{monthLabel}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="budget-amount">{t('budget.amount', { code })}</FieldLabel>
                <div className="relative">
                  <Input
                    id="budget-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    className="pr-10"
                    aria-invalid={invalid}
                    onFocus={selectOnFocus}
                    value={value}
                    onChange={(event) => {
                      setValue(event.target.value);
                      setInvalid(false);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute inset-y-0 right-1.5 my-auto text-muted-foreground"
                    aria-label={t('transactions.calculator.open')}
                    onClick={() => {
                      setCalculatorLayer((current) => current + 1);
                      setCalculating(true);
                    }}
                  >
                    <CalculatorIcon />
                  </Button>
                </div>
                <FieldError errors={invalid ? [{ message: t('validation.amount') }] : []} />
              </Field>
              {save.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{t('errors.generic')}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Spinner />}
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <CalculatorSheet
        key={`calculator-${calculatorLayer}`}
        open={open && calculating}
        onOpenChange={(next) => !next && setCalculating(false)}
        value={value}
        onDone={(amount) => {
          setValue(amount);
          setInvalid(false);
        }}
      />
    </>
  );
}
