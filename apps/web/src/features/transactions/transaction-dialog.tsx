import { zodResolver } from '@hookform/resolvers/zod';
import { RepeatIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { todayInput } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { AccountBalance, AccountPicker, KindPicker, type KindPick } from './pickers';
import { useSaveTransaction, type Transaction } from './queries';
import {
  defaultTransactionFormValues,
  pickDefaultAccountId,
  needsDestAmount,
  toTransactionBody,
  transactionFormSchema,
  transactionToFormValues,
  type TransactionFormValues,
} from './transaction-form-model';

// Amount fields start at "0": selecting on focus lets typing replace it rather than append.
const selectOnFocus = (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select();

type AccountSide = 'accountId' | 'toAccountId';

interface TransactionDialogProps {
  groupId: string;
  // The transaction to edit; absent to create one.
  transaction?: Transaction;
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
 * under them the amount, the date and a note. Either card reopens its own picker.
 *
 * A transaction whose sides are already known — an edit, a duplicate, a debt's Lend or Pay back —
 * skips the first step.
 */
export function TransactionDialog({
  groupId,
  transaction,
  template,
  defaultAccountId,
  defaultType,
  defaultToAccountId,
  open,
  onOpenChange,
}: TransactionDialogProps) {
  const { t } = useTranslation();
  const accounts = useAccounts(groupId);
  const categories = useCategories(groupId);
  const currencyCodes = useCurrencyCodes();
  const saveTransaction = useSaveTransaction(groupId);
  const [stage, setStage] = useState<'pick' | 'form'>('form');
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [accountSide, setAccountSide] = useState<AccountSide | null>(null);
  // Bumped each time a card opens its sheet, so the sheet mounts fresh, above the form.
  const [layer, setLayer] = useState(0);

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const categoryList = useMemo(() => categories.data ?? [], [categories.data]);
  const schema = useMemo(
    () =>
      transactionFormSchema(accountList, {
        required: t('validation.required'),
        amount: t('validation.amount'),
        sameAccount: t('transactions.errors.sameAccount'),
      }),
    [accountList, t],
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
  const [type, accountId, toAccountId, categoryId] = useWatch({
    control: form.control,
    name: ['type', 'accountId', 'toAccountId', 'categoryId'],
  });

  const fallbackAccountId = pickDefaultAccountId(accountList, defaultAccountId);
  useEffect(() => {
    if (!open) {
      return;
    }
    const values = transaction
      ? transactionToFormValues(transaction)
      : template
        ? { ...transactionToFormValues(template), day: todayInput() }
        : defaultTransactionFormValues({ accountId: fallbackAccountId, toAccountId: defaultToAccountId, type: defaultType });
    form.reset(values);
    // A new transaction starts with what it is, unless both its sides were handed over already.
    const known = !!transaction || !!template || (values.type === 'transfer' && !!values.toAccountId);
    setStage(known ? 'form' : 'pick');
    setKindPickerOpen(false);
    setAccountSide(null);
    // Only on opening: re-running when accounts refetch would wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction, template]);

  // Accounts can still be loading when a new transaction's dialog opens; fill the account in once
  // they arrive, unless one was picked meanwhile.
  useEffect(() => {
    if (open && !transaction && !template && fallbackAccountId && !form.getValues('accountId')) {
      form.setValue('accountId', fallbackAccountId);
    }
  }, [open, transaction, template, fallbackAccountId, form]);

  const showDestAmount = needsDestAmount({ type, accountId, toAccountId }, accountList);
  const accountOf = (id: string) => accountList.find((account) => account.id === id);
  const currencyOf = (id: string) => currencyCodes.get(accountOf(id)?.currencyId ?? -1);
  const category = categoryList.find((candidate) => candidate.id === categoryId);

  const applyPick = (pick: KindPick) => {
    form.setValue('type', pick.type);
    if (pick.type === 'transfer') {
      form.setValue('toAccountId', pick.toAccountId, { shouldValidate: form.formState.isSubmitted });
      form.setValue('categoryId', '');
    } else {
      form.setValue('categoryId', pick.categoryId);
      form.setValue('toAccountId', '');
    }
    setStage('form');
    setKindPickerOpen(false);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await saveTransaction.mutateAsync({
        transactionId: transaction?.id,
        body: toTransactionBody(values, accountList, transaction),
      });
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
  const titleFor = (kind: TransactionFormValues['type']) => t(`transactions.${transaction ? 'editOf' : 'addOf'}.${kind}`);

  const amountInput = (name: 'amount' | 'destAmount', label: string) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`transaction-${name}`}>{label}</FieldLabel>
      <Input
        id={`transaction-${name}`}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={!!errors[name]}
        onFocus={selectOnFocus}
        {...form.register(name)}
      />
      <FieldError errors={[errors[name]]} />
    </Field>
  );
  const withCurrency = (label: string, id: string) => (currencyOf(id) ? `${label} (${currencyOf(id)})` : label);

  return (
    <>
      {/* The first step: what the transaction is. Closing it closes the whole thing. */}
      <KindPicker
        open={open && stage === 'pick'}
        onOpenChange={(next) => !next && onOpenChange(false)}
        title={t('transactions.new')}
        type={type}
        categories={categoryList}
        accounts={accountList}
        fromAccountId={accountId}
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
              {transaction?.recurringRuleId && (
                <Alert>
                  <RepeatIcon />
                  <AlertDescription>{t('transactions.occurrenceNotice')}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 items-stretch gap-3">
                  {left}
                  {right}
                </div>
                <FieldError errors={[errors.accountId, errors.toAccountId]} />
              </div>

              {type === 'transfer' ? (
                // Each amount under its own side, in that side's currency.
                <div className="grid grid-cols-2 gap-3">
                  {amountInput('amount', withCurrency(t('transactions.amountWithdrawn'), accountId))}
                  {/* The same currency on both sides means the same amount arrives: nothing to ask. */}
                  {showDestAmount && amountInput('destAmount', withCurrency(t('transactions.destAmount'), toAccountId))}
                </div>
              ) : (
                amountInput('amount', withCurrency(t('transactions.amount'), accountId))
              )}

              <Field data-invalid={!!errors.day}>
                <FieldLabel htmlFor="transaction-day">{t('transactions.date')}</FieldLabel>
                <Input id="transaction-day" type="date" aria-invalid={!!errors.day} {...form.register('day')} />
                <FieldError errors={[errors.day]} />
              </Field>
              <Field data-invalid={!!errors.note}>
                <FieldLabel htmlFor="transaction-note">{t('transactions.note')}</FieldLabel>
                <Textarea id="transaction-note" rows={2} {...form.register('note')} />
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
        // The type was chosen in the first step, and an existing transaction never changes it:
        // from here the sheet only changes the category within it.
        lockedType={transaction?.type ?? type}
        categories={categoryList}
        accounts={accountList}
        fromAccountId={accountId}
        selected={type === 'transfer' ? toAccountId : categoryId}
        onPick={applyPick}
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
          setAccountSide(null);
        }}
      />
    </>
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
