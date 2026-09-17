import { zodResolver } from '@hookform/resolvers/zod';
import { RepeatIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAccounts } from '@/features/accounts/queries';
import { categoryOptions, useCategories } from '@/features/categories/queries';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { useDeleteTransaction, useSaveTransaction, type Transaction } from './queries';
import {
  defaultTransactionFormValues,
  needsDestAmount,
  toTransactionBody,
  transactionFormSchema,
  transactionToFormValues,
  type TransactionFormValues,
} from './transaction-form-model';
import { TRANSACTION_TYPE_ORDER } from './transaction-types';

// Amount fields start at "0": selecting on focus lets typing replace it rather than append.
const selectOnFocus = (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select();

// Radix Select can't hold an empty value, so "no category" needs a stand-in.
const NO_CATEGORY = 'none';

interface TransactionDialogProps {
  groupId: string;
  // The transaction to edit; absent to create one.
  transaction?: Transaction;
  // Preselected account for a new transaction, e.g. the one the list is filtered by.
  defaultAccountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDialog({ groupId, transaction, defaultAccountId, open, onOpenChange }: TransactionDialogProps) {
  const { t } = useTranslation();
  const accounts = useAccounts(groupId);
  const categories = useCategories(groupId);
  const currencyCodes = useCurrencyCodes();
  const saveTransaction = useSaveTransaction(groupId);
  const deleteTransaction = useDeleteTransaction(groupId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
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
  const [type, accountId, toAccountId] = useWatch({ control: form.control, name: ['type', 'accountId', 'toAccountId'] });

  const fallbackAccountId = defaultAccountId ?? accountList[0]?.id;
  useEffect(() => {
    if (open) {
      form.reset(transaction ? transactionToFormValues(transaction) : defaultTransactionFormValues({ accountId: fallbackAccountId }));
    }
    // Only on opening: re-running when accounts refetch would wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  const options = useMemo(
    () => (type === 'transfer' ? [] : categoryOptions(categories.data ?? [], type)),
    [categories.data, type],
  );
  const showDestAmount = needsDestAmount({ type, accountId, toAccountId }, accountList);
  const currencyOf = (id: string) => currencyCodes.get(accountList.find((account) => account.id === id)?.currencyId ?? -1);

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

  const onDelete = async () => {
    if (!transaction) {
      return;
    }
    try {
      await deleteTransaction.mutateAsync(transaction.id);
      setConfirmingDelete(false);
      onOpenChange(false);
    } catch {
      setConfirmingDelete(false);
      form.setError('root', { message: t('errors.generic') });
    }
  };

  const accountSelect = (name: 'accountId' | 'toAccountId', id: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select value={field.value || undefined} onValueChange={field.onChange}>
          <SelectTrigger id={id} className="w-full" aria-invalid={!!errors[name]}>
            <SelectValue placeholder={t('transactions.chooseAccount')} />
          </SelectTrigger>
          <SelectContent>
            {accountList.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}{' '}
                <span className="text-muted-foreground">{currencyCodes.get(account.currencyId)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(transaction ? 'transactions.edit' : 'transactions.new')}</DialogTitle>
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
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    className="w-full"
                    value={field.value}
                    onValueChange={(value) => {
                      // Deselecting the active item reports ''; a type is always required.
                      if (value) {
                        field.onChange(value);
                        form.setValue('categoryId', '');
                      }
                    }}
                  >
                    {TRANSACTION_TYPE_ORDER.map((option) => (
                      <ToggleGroupItem key={option} value={option} className="flex-1">
                        {t(`transactions.types.${option}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
              />
              <Field data-invalid={!!errors.amount}>
                <FieldLabel htmlFor="transaction-amount">
                  {t('transactions.amount')} {currencyOf(accountId) && `(${currencyOf(accountId)})`}
                </FieldLabel>
                <Input
                  id="transaction-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={!!errors.amount}
                  onFocus={selectOnFocus}
                  {...form.register('amount')}
                />
                <FieldError errors={[errors.amount]} />
              </Field>
              <Field data-invalid={!!errors.accountId}>
                <FieldLabel htmlFor="transaction-account">
                  {t(type === 'transfer' ? 'transactions.fromAccount' : 'transactions.account')}
                </FieldLabel>
                {accountSelect('accountId', 'transaction-account')}
                <FieldError errors={[errors.accountId]} />
              </Field>
              {type === 'transfer' ? (
                <>
                  <Field data-invalid={!!errors.toAccountId}>
                    <FieldLabel htmlFor="transaction-to-account">{t('transactions.toAccount')}</FieldLabel>
                    {accountSelect('toAccountId', 'transaction-to-account')}
                    <FieldError errors={[errors.toAccountId]} />
                  </Field>
                  {showDestAmount && (
                    <Field data-invalid={!!errors.destAmount}>
                      <FieldLabel htmlFor="transaction-dest-amount">
                        {t('transactions.destAmount')} ({currencyOf(toAccountId)})
                      </FieldLabel>
                      <Input
                        id="transaction-dest-amount"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-invalid={!!errors.destAmount}
                        onFocus={selectOnFocus}
                        {...form.register('destAmount')}
                      />
                      <FieldError errors={[errors.destAmount]} />
                    </Field>
                  )}
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="transaction-category">{t('transactions.category')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <Select
                        value={field.value || NO_CATEGORY}
                        onValueChange={(value) => field.onChange(value === NO_CATEGORY ? '' : value)}
                      >
                        <SelectTrigger id="transaction-category" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_CATEGORY}>{t('transactions.noCategory')}</SelectItem>
                          {options.map(({ category, depth }) => (
                            <SelectItem key={category.id} value={category.id}>
                              <span style={{ paddingInlineStart: `${depth}rem` }}>{category.name}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
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
              {transaction && (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t('common.delete')}
                </Button>
              )}
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

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('transactions.deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(transaction?.recurringRuleId ? 'transactions.deleteConfirm.occurrence' : 'transactions.deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteTransaction.isPending}
              onClick={(event) => {
                // Keep the confirmation open until the request settles.
                event.preventDefault();
                void onDelete();
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
