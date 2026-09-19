import { zodResolver } from '@hookform/resolvers/zod';
import { BanknoteIcon, CalendarDaysIcon, ChevronRightIcon, RepeatIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAccounts } from '@/features/accounts/queries';
import { categoriesUnder, useCategories } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { toDayInput, todayInput } from '@/lib/dates';
import { formatMoney, formatPercentage, isValidAmountInput, parseMoneyInput, parsePercentageInput } from '@/lib/money';
import { transactionTypeColor } from '@/lib/money-colors';
import { capitalizeFirst } from '@/lib/text';
import { cn } from '@/lib/utils';
import { AmountSheet } from './amount-sheet';
import { DateSheet } from './date-sheet';
import { AccountBalance, AccountPicker, KindPicker, type KindPick } from './pickers';
import {
  useDeleteRecurringRule,
  useSaveRecurringRule,
  useSaveTransaction,
  type RecurringRule,
  type Transaction,
} from './queries';
import { parseRepeatKey, repeatOf, useRepeatLabel } from './repeat';
import {
  derivedAmount,
  defaultTransactionFormValues,
  isPlannedDay,
  nextDateOf,
  pickDefaultAccountId,
  needsDestAmount,
  parseRoundBalanceTo,
  ruleToFormValues,
  toRecurringRuleBody,
  toRecurringRulePatch,
  toTransactionBody,
  transactionFormSchema,
  transactionToFormValues,
  type TransactionFormValues,
} from './transaction-form-model';

type AccountSide = 'accountId' | 'toAccountId';

interface TransactionDialogProps {
  groupId: string;
  // The transaction to edit; absent to create one.
  transaction?: Transaction;
  // A series to edit instead, opened from its planned occurrence.
  rule?: RecurringRule;
  // For a new transaction: one to copy everything from but the date, which starts at today.
  template?: Transaction;
  // Preselected account for a new transaction, e.g. the one the list is filtered by.
  defaultAccountId?: string;
  // The tab a new transaction's first step opens on, e.g. from an account's Income action.
  defaultType?: TransactionFormValues['type'];
  // For a new transfer: where the money goes, e.g. the person an account's Lend action is for.
  defaultToAccountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Recording a transaction, in two steps.
 *
 * First what it is: a sheet of tabs, income, expense and transfer, listing categories — or, for a
 * transfer, the accounts to send to. Then the form: the two sides as cards, the way the money
 * flows (a category into an account, an account into a category, one account into another), and
 * under them the amount, the date and a note. Either card reopens its own picker, and a category
 * with subcategories offers them as chips under the cards.
 *
 * A transaction whose sides are already known — an edit, a duplicate, a debt's Lend or Pay back —
 * skips the first step.
 *
 * How much is a card as well, opening the Amount sheet: the amount typed, or worked out as a
 * percentage — of the account's balance, as a card's monthly charge is of its debt, or of an amount
 * typed beside it, as a tax is of an income.
 *
 * When it happens is a card of its own, opening a sheet with a calendar and, where it can, how
 * often it repeats. A new transaction that repeats is saved as a series, whose first transaction is
 * the one on that date. The same form edits a series, from its planned occurrence: its next date for
 * the date, and repeating "never" ends it with that transaction. A transaction recorded today or
 * before changes alone and can't repeat; a planned one-off can start repeating.
 */
export function TransactionDialog({
  groupId,
  transaction,
  rule,
  template,
  defaultAccountId,
  defaultType,
  defaultToAccountId,
  open,
  onOpenChange,
}: TransactionDialogProps) {
  const { t, i18n } = useTranslation();
  const { ability } = useGroupScope();
  const accounts = useAccounts(groupId);
  const categories = useCategories(groupId);
  const currencyCodes = useCurrencyCodes();
  const saveTransaction = useSaveTransaction(groupId);
  const saveRule = useSaveRecurringRule(groupId);
  const deleteRule = useDeleteRecurringRule(groupId);
  const [stage, setStage] = useState<'pick' | 'form'>('form');
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [accountSide, setAccountSide] = useState<AccountSide | null>(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  // Bumped each time a card opens its sheet, so the sheet mounts fresh, above the form.
  const [layer, setLayer] = useState(0);

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const categoryList = useMemo(() => categories.data ?? [], [categories.data]);
  const accountOf = (id: string) => accountList.find((account) => account.id === id);
  const seriesNextDay = rule ? toDayInput(nextDateOf(rule)) : undefined;
  const schema = useMemo(
    () =>
      transactionFormSchema(
        accountList,
        {
          required: t('validation.required'),
          amount: t('validation.amount'),
          sameAccount: t('transactions.errors.sameAccount'),
          repeatCurrency: t('transactions.errors.repeatCurrency'),
          pastNextDate: t('transactions.errors.pastNextDate'),
          percentage: t('validation.percentage'),
          percentageAmount: t('transactions.errors.percentageAmount'),
          roundBalanceAmount: t('transactions.errors.roundBalanceAmount'),
        },
        { seriesNextDay },
      ),
    [accountList, t, seriesNextDay],
  );
  // The schema depends on the accounts (for cross-currency checks), which can load after the form
  // is created; the resolver reads the current one rather than the one from the first render.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const form = useForm<TransactionFormValues>({
    resolver: (values, context, options) => zodResolver(schemaRef.current)(values, context, options),
    defaultValues: defaultTransactionFormValues({}),
  });
  const errors = form.formState.errors;
  const [type, accountId, toAccountId, categoryId, day, repeat, amount, destAmount, percentage, percentageBase, roundBalanceTo] =
    useWatch({
      control: form.control,
      name: [
        'type',
        'accountId',
        'toAccountId',
        'categoryId',
        'day',
        'repeat',
        'amount',
        'destAmount',
        'percentage',
        'percentageBase',
        'roundBalanceTo',
      ],
    });

  // Works the amount out from the percentage, when there is one: of the base amount if one is
  // typed, otherwise of the balance of the account the transaction is on — where an expense or a
  // transfer takes the money from, where an income puts it. Run when any of those changes, but not
  // on opening a saved transaction: its amount may have come from the balance as it was then, and
  // opening it to fix a note mustn't restate it.
  const recalculate = () => {
    const worked = derivedAmount(form.getValues(), form.getValues('type'), accountOf(form.getValues('accountId')), transaction);
    if (worked !== null) {
      form.setValue('amount', worked, { shouldValidate: form.formState.isSubmitted });
    }
  };

  const fallbackAccountId = pickDefaultAccountId(accountList, defaultAccountId);
  useEffect(() => {
    if (!open) {
      return;
    }
    const values = rule
      ? ruleToFormValues(rule)
      : transaction
        ? transactionToFormValues(transaction)
        : template
          ? { ...transactionToFormValues(template), day: todayInput() }
          : defaultTransactionFormValues({ accountId: fallbackAccountId, toAccountId: defaultToAccountId, type: defaultType });
    form.reset(values);
    // A duplicate is a new transaction, and a series works its amount out again on each date: without
    // a base amount, their percentage is of the balance as it stands today.
    if (rule || (!transaction && template)) {
      recalculate();
    }
    // A new transaction starts with what it is, unless both its sides were handed over already.
    const known = !!rule || !!transaction || !!template || (values.type === 'transfer' && !!values.toAccountId);
    setStage(known ? 'form' : 'pick');
    setKindPickerOpen(false);
    setAccountSide(null);
    setDateSheetOpen(false);
    setAmountSheetOpen(false);
    // Only on opening: re-running when accounts refetch would wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction, template, rule]);

  // Accounts can still be loading when a new transaction's dialog opens; fill the account in once
  // they arrive, unless one was picked meanwhile.
  useEffect(() => {
    if (open && !rule && !transaction && !template && fallbackAccountId && !form.getValues('accountId')) {
      form.setValue('accountId', fallbackAccountId);
    }
  }, [open, rule, transaction, template, fallbackAccountId, form]);

  // What saving changes: a new transaction (or series), one recorded today or before (that one
  // alone), a planned one-off (which can start repeating), or a series from its planned occurrence.
  const mode = rule ? 'series' : !transaction ? 'new' : isPlannedDay(transaction.date) ? 'planned' : 'recorded';
  const mayStartSeries = ability.can('create', 'RecurringRule');
  const canRepeat =
    mode === 'series' ||
    (mode === 'new' && mayStartSeries) ||
    // A new series takes the planned one-off's place, which deletes it; an occurrence of a series
    // that no longer runs can't be taken over.
    (mode === 'planned' && mayStartSeries && ability.can('delete', 'Transaction') && !transaction?.recurringRuleId);

  const showDestAmount = needsDestAmount({ type, accountId, toAccountId }, accountList);
  const currencyOf = (id: string) => currencyCodes.get(accountOf(id)?.currencyId ?? -1);
  const category = categoryList.find((candidate) => candidate.id === categoryId);
  // The chosen category's own subcategories, offered as chips under the cards.
  const subcategories = useMemo(
    () => (type === 'transfer' || !categoryId ? [] : categoriesUnder(categoryList, type, categoryId)),
    [categoryList, type, categoryId],
  );

  const applyPick = (pick: KindPick) => {
    form.setValue('type', pick.type);
    if (pick.type === 'transfer') {
      // The source was only a default; if that's where the money goes, it comes from elsewhere.
      if (pick.toAccountId === form.getValues('accountId')) {
        const others = accountList.filter((account) => account.id !== pick.toAccountId);
        form.setValue('accountId', pickDefaultAccountId(others) ?? '');
      }
      form.setValue('toAccountId', pick.toAccountId, { shouldValidate: form.formState.isSubmitted });
      form.setValue('categoryId', '');
      form.setValue('subcategoryId', '');
    } else {
      // A subcategory belongs to the category it was chosen under: another category drops it,
      // picking the same one again keeps it.
      if (pick.categoryId !== form.getValues('categoryId')) {
        form.setValue('subcategoryId', '');
      }
      form.setValue('categoryId', pick.categoryId);
      form.setValue('toAccountId', '');
    }
    // The account may have changed, and the type decides which way a rounding goes.
    recalculate();
    setStage('form');
    setKindPickerOpen(false);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (rule) {
        await saveRule.mutateAsync({ ruleId: rule.id, body: toRecurringRulePatch(values, accountList, rule) });
        // Repeating "never": the series ends with its planned transaction, which stays.
        if (!values.repeat) {
          await deleteRule.mutateAsync({ ruleId: rule.id, keepPlanned: true });
        }
      } else if (values.repeat && (mode === 'new' || mode === 'planned')) {
        await saveRule.mutateAsync({
          body: toRecurringRuleBody(values, accountList, undefined, undefined, mode === 'planned' ? transaction : undefined),
        });
      } else if (transaction) {
        await saveTransaction.mutateAsync({ transactionId: transaction.id, body: toTransactionBody(values, accountList, transaction) });
      } else {
        await saveTransaction.mutateAsync({ body: toTransactionBody(values, accountList) });
      }
      onOpenChange(false);
    } catch {
      form.setError('root', { message: t('errors.generic') });
    }
  });

  const accountCard = (side: AccountSide, caption: string) => {
    const account = accountOf(side === 'accountId' ? accountId : toAccountId);
    return (
      <SideCard
        caption={caption}
        invalid={!!errors[side]}
        onClick={() => {
          setLayer((current) => current + 1);
          setAccountSide(side);
        }}
        icon={<AppearanceIcon icon={account?.icon} color={account?.color} fallbackIcon="wallet" />}
        name={account?.name ?? t('transactions.chooseAccount')}
        detail={account && <AccountBalance account={account} className="text-xs" />}
      />
    );
  };
  const categoryCard = (
    <SideCard
      caption={t('transactions.category')}
      onClick={() => {
        setLayer((current) => current + 1);
        setKindPickerOpen(true);
      }}
      icon={<AppearanceIcon icon={category?.icon} color={category?.color} placeholder={category ? undefined : 'none'} />}
      name={category?.name ?? t('transactions.noCategory')}
    />
  );

  // The money flows left to right, which the cards' captions spell out: from a category into an
  // account, from an account into a category, or from one account into another.
  const [left, right] =
    type === 'income'
      ? [categoryCard, accountCard('accountId', t('transactions.toAccount'))]
      : type === 'expense'
        ? [accountCard('accountId', t('transactions.fromAccount')), categoryCard]
        : [accountCard('accountId', t('transactions.fromAccount')), accountCard('toAccountId', t('transactions.toAccount'))];
  // "Add expense", "Edit transfer": the type is part of what the dialog is for.
  const titleFor = (kind: TransactionFormValues['type']) =>
    t(`transactions.${rule ? 'editSeriesOf' : transaction ? 'editOf' : 'addOf'}.${kind}`);

  const withCurrency = (label: string, id: string) => (currencyOf(id) ? `${label} (${currencyOf(id)})` : label);
  // A figure as the inputs hold it, shown in the given account's currency.
  const moneyIn = (value: string, id: string) => {
    const parsed = parseMoneyInput(value);
    return parsed === null ? value : formatMoney(parsed, currencyOf(id), i18n.language, { currencyDisplay: 'narrowSymbol' });
  };
  // Under the amount on its card, a line each: what arrives across currencies, and what the
  // amount was worked out from.
  const amountLines: string[] = [];
  if (showDestAmount) {
    amountLines.push(t('transactions.receivedAmount', { amount: moneyIn(destAmount, toAccountId) }));
  }
  const validPercentage = parsePercentageInput(percentage);
  const step = validPercentage ? null : parseRoundBalanceTo(roundBalanceTo);
  const accountName = accountOf(accountId)?.name ?? '';
  if (validPercentage) {
    const shown = formatPercentage(validPercentage, i18n.language);
    amountLines.push(
      percentageBase.trim()
        ? t('transactions.percentageOfBase', { percentage: shown, base: moneyIn(percentageBase, accountId) })
        : t('transactions.percentageOfBalance', { percentage: shown, account: accountName }),
    );
  } else if (step) {
    amountLines.push(
      t('transactions.roundsBalanceOf', { step: new Intl.NumberFormat(i18n.language).format(step), account: accountName }),
    );
  }
  // A balance still to come: the figure above is today's, and it follows the account until the day.
  if (((validPercentage && !percentageBase.trim()) || step) && (repeat || day > todayInput())) {
    amountLines.push(t(repeat ? 'transactions.percentageSeriesOnTheDay' : 'transactions.percentageOnTheDay'));
  }
  // Only those there are: FieldError lists several as bullets, and counts an empty slot as one.
  const amountErrors = [errors.amount, errors.destAmount, errors.percentage, errors.percentageBase, errors.roundBalanceTo].filter(
    (error) => error !== undefined,
  );

  return (
    <>
      {/* The first step: what the transaction is. Closing it closes the whole thing. */}
      <KindPicker
        open={open && stage === 'pick'}
        onOpenChange={(next) => !next && onOpenChange(false)}
        title={t('transactions.new')}
        type={type}
        categories={categoryList}
        // Every account can be the target here: the source so far is only a default.
        accounts={accountList}
        selected={type === 'transfer' ? toAccountId : categoryId}
        onPick={applyPick}
      />

      <Dialog open={open && stage === 'form'} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{titleFor(type)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup className="gap-4">
              {errors.root?.message && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              {rule && (
                <Alert>
                  <RepeatIcon />
                  <AlertDescription>{t('transactions.seriesNotice')}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 items-stretch gap-3">
                  {left}
                  {right}
                </div>
                <FieldError errors={[errors.accountId, errors.toAccountId]} />
              </div>

              {/* The category's subcategories, as chips under the cards. Picking one is optional,
                  and tapping the chosen chip again goes back to the category alone. */}
              {subcategories.length > 0 && (
                <Controller
                  control={form.control}
                  name="subcategoryId"
                  render={({ field }) => (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      className="w-full flex-wrap justify-start"
                      aria-label={t('transactions.subcategory')}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {subcategories.map((subcategory) => (
                        <ToggleGroupItem
                          key={subcategory.id}
                          value={subcategory.id}
                          className="rounded-full pl-1 data-[state=on]:border-foreground/60"
                        >
                          <AppearanceIcon icon={subcategory.icon} color={subcategory.color} size="sm" />
                          {subcategory.name}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  )}
                />
              )}

              <div className="flex flex-col gap-1">
                <AmountCard
                  caption={withCurrency(t('transactions.amount'), accountId)}
                  amount={moneyIn(amount, accountId)}
                  // In the type's colour once there is one; muted while it's still nothing.
                  tone={isValidAmountInput(amount) ? transactionTypeColor(type) : 'text-muted-foreground'}
                  lines={amountLines}
                  invalid={amountErrors.length > 0}
                  onClick={() => {
                    setLayer((current) => current + 1);
                    setAmountSheetOpen(true);
                  }}
                />
                <FieldError errors={amountErrors} />
              </div>

              {/* When it happens: the day, and how often it repeats if it does. */}
              <div className="flex flex-col gap-1">
                <DateCard
                  caption={t(rule ? 'transactions.nextDate' : 'transactions.date')}
                  day={day}
                  repeat={repeat}
                  invalid={!!errors.day || !!errors.repeat}
                  onClick={() => {
                    setLayer((current) => current + 1);
                    setDateSheetOpen(true);
                  }}
                />
                <FieldError errors={[errors.day, errors.repeat]} />
              </div>
              <Field data-invalid={!!errors.note}>
                <FieldLabel htmlFor="transaction-note">{t('transactions.note')}</FieldLabel>
                {/* Italic while it's typed too, so it looks the way it will read in the list. */}
                <Textarea id="transaction-note" rows={2} className="italic" {...form.register('note')} />
                <FieldError errors={[errors.note]} />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/*
        Opened from the form's cards, so they belong above it. A sheet stacks by where it sits in
        the page, and one that stayed mounted from an earlier opening would sit under a form
        mounted since; a new key each time makes it a fresh one, on top.
      */}
      <KindPicker
        key={`category-${layer}`}
        open={open && kindPickerOpen}
        onOpenChange={(next) => !next && setKindPickerOpen(false)}
        title={titleFor(type)}
        type={type}
        // The type was chosen in the first step, and an existing transaction or series never
        // changes it: from here the sheet only changes the category within it.
        lockedType={rule?.type ?? transaction?.type ?? type}
        categories={categoryList}
        accounts={accountList}
        fromAccountId={accountId}
        selected={type === 'transfer' ? toAccountId : categoryId}
        onPick={applyPick}
      />

      <DateSheet
        key={`date-${layer}`}
        open={open && dateSheetOpen}
        onOpenChange={setDateSheetOpen}
        title={t(rule ? 'transactions.nextDate' : 'transactions.date')}
        value={{ day, repeat }}
        canRepeat={canRepeat}
        currentRepeat={rule ? repeatOf(rule) : null}
        // A series moves on from today: its next date can't be in the past.
        minDay={rule ? todayInput() : undefined}
        warnsOfPastDates={mode === 'new'}
        onDone={(choice) => {
          const validate = { shouldValidate: form.formState.isSubmitted };
          form.setValue('day', choice.day, validate);
          form.setValue('repeat', choice.repeat, validate);
          setDateSheetOpen(false);
        }}
      />

      <AmountSheet
        key={`amount-${layer}`}
        open={open && amountSheetOpen}
        onOpenChange={setAmountSheetOpen}
        sides={{ type, accountId, toAccountId }}
        accounts={accountList}
        editing={transaction}
        values={{ amount, destAmount, percentage, percentageBase, roundBalanceTo }}
        onDone={(values) => {
          for (const name of ['amount', 'destAmount', 'percentage', 'percentageBase', 'roundBalanceTo'] as const) {
            form.setValue(name, values[name], { shouldValidate: form.formState.isSubmitted });
          }
        }}
      />

      <AccountPicker
        key={`account-${layer}`}
        open={open && accountSide !== null}
        onOpenChange={(next) => !next && setAccountSide(null)}
        title={t(
          accountSide === 'toAccountId' || (accountSide === 'accountId' && type === 'income')
            ? 'transactions.toAccount'
            : 'transactions.fromAccount',
        )}
        accounts={accountList}
        selectedId={accountSide === 'toAccountId' ? toAccountId : accountId}
        excludeId={type === 'transfer' ? (accountSide === 'toAccountId' ? accountId : toAccountId) : undefined}
        onPick={(id) => {
          if (accountSide) {
            form.setValue(accountSide, id, { shouldValidate: form.formState.isSubmitted });
          }
          // The percentage is of this account's balance: another account, another amount.
          if (accountSide === 'accountId') {
            recalculate();
          }
          setAccountSide(null);
        }}
      />
    </>
  );
}

/** How much, tappable to change it in the Amount sheet: laid out like the date's card below it. */
function AmountCard({
  caption,
  amount,
  tone,
  lines,
  invalid,
  onClick,
}: {
  caption: string;
  amount: string;
  tone: string;
  // Further lines under the amount, each on its own: sentences, so they wrap rather than cut off.
  lines: string[];
  invalid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // As on the side cards: the red border says it, the error text under the card is what
      // assistive technology reads.
      data-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        invalid && 'border-destructive',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <BanknoteIcon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{caption}</span>
        <span className={cn('truncate text-base font-semibold tabular-nums', tone)}>{amount}</span>
        {lines.map((line) => (
          <span key={line} className="text-sm text-muted-foreground">
            {line}
          </span>
        ))}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** When it happens, tappable to change: the day, and on a line of its own how often it repeats. */
function DateCard({
  caption,
  day,
  repeat,
  invalid,
  onClick,
}: {
  caption: string;
  day: string;
  repeat: string;
  invalid?: boolean;
  onClick: () => void;
}) {
  const { i18n } = useTranslation();
  const repeatLabel = useRepeatLabel();
  const repeats = parseRepeatKey(repeat);
  const dayText = day
    ? capitalizeFirst(
        new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(
          new Date(`${day}T00:00`),
        ),
        i18n.language,
      )
    : '—';

  return (
    <button
      type="button"
      onClick={onClick}
      data-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        invalid && 'border-destructive',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <CalendarDaysIcon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{caption}</span>
        <span className="truncate font-medium">{dayText}</span>
        {repeats && (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <RepeatIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{repeatLabel(repeats)}</span>
          </span>
        )}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** One side of a transaction, tappable to change it. */
function SideCard({
  caption,
  icon,
  name,
  detail,
  invalid,
  onClick,
}: {
  caption: string;
  icon: ReactNode;
  name: string;
  detail?: ReactNode;
  invalid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // A button can't be "invalid"; the red border says it, and the error text under the cards
      // is what assistive technology reads.
      data-invalid={invalid || undefined}
      className={cn(
        'flex min-w-0 flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        invalid && 'border-destructive',
      )}
    >
      <span className="text-xs text-muted-foreground">{caption}</span>
      <span className="flex w-full min-w-0 items-center gap-2">
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      </span>
      {detail}
    </button>
  );
}
