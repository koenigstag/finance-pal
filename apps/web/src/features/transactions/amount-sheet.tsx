import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Account } from '@/features/accounts/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatPercentage, parsePercentageInput } from '@/lib/money';
import type { Transaction } from './queries';
import {
  amountFormSchema,
  amountFromPercentage,
  balanceBase,
  needsDestAmount,
  type AmountValues,
  type TransactionSides,
} from './transaction-form-model';

// Amount fields start at "0": selecting on focus lets typing replace it rather than append.
const selectOnFocus = (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select();

interface AmountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The transaction's sides as the form has them: which amounts it needs, in which currencies,
  // and whose balance a percentage is of.
  sides: TransactionSides;
  accounts: Account[];
  // The saved transaction being edited, if any: its own share stays out of that balance.
  editing?: Transaction;
  // The figures the sheet starts from. Read once, when it mounts: the form gives it a new key
  // for each opening.
  values: AmountValues;
  // Valid figures, handed back to the form on Done; the form saves them with the rest.
  onDone: (values: AmountValues) => void;
}

/**
 * A transaction's amounts, opened from the form's Amount card: the amount itself — a transfer
 * between currencies has two — and, under Advanced, a checkbox to work it out as a percentage
 * instead, of an optional base amount or else of the account's balance.
 */
export function AmountSheet({ open, onOpenChange, sides, accounts, editing, values, onDone }: AmountSheetProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  // Open when it holds what the amount comes from.
  const [advancedOpen, setAdvancedOpen] = useState(values.percentage !== '');
  // Off unless the amount already is a percentage: its fields only show once asked for.
  const [percentageOn, setPercentageOn] = useState(values.percentage !== '');

  const schema = useMemo(
    () =>
      amountFormSchema(sides, accounts, {
        amount: t('validation.amount'),
        percentage: t('validation.percentage'),
        percentageAmount: t('transactions.errors.percentageAmount'),
      }),
    [sides, accounts, t],
  );
  // As in the form: accounts can refetch while the sheet is open, and the resolver should check
  // against the current ones rather than those of the first render.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const form = useForm<AmountValues>({
    resolver: (input, context, options) => zodResolver(schemaRef.current)(input, context, options),
    defaultValues: values,
  });
  const errors = form.formState.errors;
  const percentage = useWatch({ control: form.control, name: 'percentage' });

  const accountOf = (id: string) => accounts.find((account) => account.id === id);
  const account = accountOf(sides.accountId);
  const currencyOf = (id: string) => currencyCodes.get(accountOf(id)?.currencyId ?? -1);
  const withCurrency = (label: string, id: string) => (currencyOf(id) ? `${label} (${currencyOf(id)})` : label);

  // Works the amount out again whenever the percentage or its base changes; the account is the
  // form's, fixed while the sheet is open.
  const recalculate = () => {
    const amount = amountFromPercentage(form.getValues(), account, editing);
    if (amount !== null) {
      form.setValue('amount', amount, { shouldValidate: form.formState.isSubmitted });
    }
  };

  // Switched on, typing goes on at the percentage. Switched off, the amount is typed again: the
  // percentage and its base go, and the figure they came to stays, to keep or to retype.
  const focusPercentage = useRef(false);
  const switchPercentage = (on: boolean) => {
    setPercentageOn(on);
    if (on) {
      focusPercentage.current = true;
      return;
    }
    form.setValue('percentage', '');
    form.setValue('percentageBase', '');
    form.clearErrors(['percentage', 'percentageBase']);
  };
  // Once its field has rendered, and only when ticked by hand: a sheet opening on a percentage
  // already there leaves the focus where the dialog puts it.
  useEffect(() => {
    if (percentageOn && focusPercentage.current) {
      focusPercentage.current = false;
      form.setFocus('percentage');
    }
  }, [percentageOn, form]);

  const onSubmit = form.handleSubmit(
    (valid) => {
      // Asked for, a percentage has to be there; an amount that's simply typed has the box unticked.
      if (percentageOn && !valid.percentage.trim()) {
        form.setError('percentage', { message: t('validation.percentage') }, { shouldFocus: true });
        setAdvancedOpen(true);
        return;
      }
      onDone(valid);
      onOpenChange(false);
    },
    // A wrong percentage or base amount may sit in the folded section, out of sight.
    (invalid) => {
      if (invalid.percentage || invalid.percentageBase) {
        setAdvancedOpen(true);
      }
    },
  );

  // Any percentage typed, even one still wrong, takes the amount over: it's what the amount comes
  // from, and a figure typed beside it would be overwritten by the next change to it.
  const derived = percentage.trim() !== '';
  const validPercentage = parsePercentageInput(percentage);

  const amountInput = (name: 'amount' | 'destAmount', label: string) => {
    // Only the amount taken from the account, which the percentage is of; what arrives across
    // currencies is still typed.
    const disabled = name === 'amount' && derived;
    return (
      <Field data-invalid={!!errors[name]} data-disabled={disabled}>
        <FieldLabel htmlFor={`amount-sheet-${name}`}>{label}</FieldLabel>
        <Input
          id={`amount-sheet-${name}`}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={!!errors[name]}
          onFocus={selectOnFocus}
          {...form.register(name)}
          // On the element, not through register's `disabled` option, which would also leave the
          // worked-out amount out of what's submitted.
          disabled={disabled}
        />
        <FieldError errors={[errors[name]]} />
      </Field>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('transactions.amount')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="gap-4">
            {sides.type === 'transfer' ? (
              // Each amount in its own side's currency.
              <div className="grid grid-cols-2 gap-3">
                {amountInput('amount', withCurrency(t('transactions.amountWithdrawn'), sides.accountId))}
                {/* The same currency on both sides means the same amount arrives: nothing to ask. */}
                {needsDestAmount(sides, accounts) &&
                  amountInput('destAmount', withCurrency(t('transactions.destAmount'), sides.toAccountId))}
              </div>
            ) : (
              amountInput('amount', withCurrency(t('transactions.amount'), sides.accountId))
            )}

            <Accordion
              type="single"
              collapsible
              value={advancedOpen ? 'advanced' : ''}
              onValueChange={(value) => setAdvancedOpen(value === 'advanced')}
            >
              <AccordionItem value="advanced">
                <AccordionTrigger className="py-1">
                  {/* Taking the free space, it keeps what follows next to the chevron. */}
                  <span className="flex-1">{t('transactions.advanced')}</span>
                  {/* Folded away, the section still says where the amount comes from. */}
                  {!advancedOpen && validPercentage && (
                    <span className="mr-2 font-normal text-muted-foreground">
                      {formatPercentage(validPercentage, i18n.language)}
                    </span>
                  )}
                </AccordionTrigger>
                {/* Unlike the stock one, its height follows what's in it, so an error showing up
                    under a field isn't clipped, and it spaces fields the way the form does rather
                    than paragraphs of prose. */}
                <AccordionContent className="h-auto pt-2 pb-0 [&_p:not(:last-child)]:mb-0">
                  <FieldGroup className="gap-4">
                    {/* A card that ticks as a whole; the percentage's fields only show while it's ticked. */}
                    <FieldLabel htmlFor="amount-sheet-percentage-on">
                      <Field orientation="horizontal">
                        <Checkbox
                          id="amount-sheet-percentage-on"
                          checked={percentageOn}
                          onCheckedChange={(checked) => switchPercentage(checked === true)}
                        />
                        <FieldContent>
                          <FieldTitle>{t('transactions.percentageMode')}</FieldTitle>
                          <FieldDescription>{t('transactions.percentageModeHint')}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                    {percentageOn && (
                      <>
                        <Field data-invalid={!!errors.percentage}>
                          <FieldLabel htmlFor="amount-sheet-percentage">{t('transactions.percentage')}</FieldLabel>
                          <div className="relative">
                            <Input
                              id="amount-sheet-percentage"
                              inputMode="decimal"
                              autoComplete="off"
                              className="pr-7"
                              aria-invalid={!!errors.percentage}
                              {...form.register('percentage', { onChange: recalculate })}
                            />
                            <span
                              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground"
                              aria-hidden
                            >
                              %
                            </span>
                          </div>
                          <FieldError errors={[errors.percentage]} />
                        </Field>
                        {/* Optional: what the percentage is of, in the account's currency, when it
                            isn't the account's balance — the income a tax is a share of, say. */}
                        <Field data-invalid={!!errors.percentageBase}>
                          <FieldLabel htmlFor="amount-sheet-percentageBase">
                            {withCurrency(t('transactions.percentageBase'), sides.accountId)}
                          </FieldLabel>
                          <Input
                            id="amount-sheet-percentageBase"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-invalid={!!errors.percentageBase}
                            {...form.register('percentageBase', { onChange: recalculate })}
                          />
                          {account && (
                            <FieldDescription>
                              {t(
                                balanceBase(account, editing) === account.balance
                                  ? 'transactions.percentageBaseHint'
                                  : 'transactions.percentageBaseHintWithout',
                                { account: account.name },
                              )}
                            </FieldDescription>
                          )}
                          <FieldError errors={[errors.percentageBase]} />
                        </Field>
                      </>
                    )}
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('common.done')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
