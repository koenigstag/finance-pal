import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ACCOUNT_TYPES, accountsContract } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrencies } from '@/features/currencies/queries';
import { useProfile } from '@/features/profile/queries';
import { DeleteAccountDialog } from './delete-account-dialog';
import { useSaveAccount, type Account } from './queries';

const accountFormSchema = accountsContract.create.body.extend({
  name: z.string().trim().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  isIncludedInBalance: z.boolean(),
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

interface AccountDialogProps {
  groupId: string;
  // The account to edit; absent to create one.
  account?: Account;
  // Whether the caller may delete the account being edited.
  canDelete?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDialog({ groupId, account, canDelete = false, open, onOpenChange }: AccountDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const profile = useProfile();
  const saveAccount = useSaveAccount(groupId);
  const form = useForm<AccountFormValues>({ resolver: zodResolver(accountFormSchema) });
  const errors = form.formState.errors;

  // Reset on every open, so the form never shows what was typed into a previous, cancelled one.
  useEffect(() => {
    if (open) {
      form.reset(
        account
          ? {
              name: account.name,
              type: account.type,
              currencyId: account.currencyId,
              isIncludedInBalance: account.isIncludedInBalance,
            }
          : {
              name: '',
              type: 'regular',
              currencyId: profile.data?.mainCurrencyId ?? currencies.data?.[0]?.id ?? 1,
              isIncludedInBalance: true,
            },
      );
    }
  }, [open, account, form, profile.data, currencies.data]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await saveAccount.mutateAsync({ accountId: account?.id, body: values });
      onOpenChange(false);
    } catch {
      form.setError('root', { message: t('errors.generic') });
    }
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(account ? 'accounts.edit' : 'accounts.new')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              {errors.root?.message && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="account-name">{t('accounts.name')}</FieldLabel>
                <Input id="account-name" aria-invalid={!!errors.name} {...form.register('name')} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-type">{t('accounts.type')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="account-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`accounts.types.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-currency">{t('accounts.currency')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="currencyId"
                  render={({ field }) => (
                    // Fixed after creation: existing transactions were recorded in this currency.
                    <Select
                      value={field.value === undefined ? undefined : String(field.value)}
                      onValueChange={(value) => field.onChange(Number(value))}
                      disabled={!!account}
                    >
                      <SelectTrigger id="account-currency" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencies.data?.map((currency) => (
                          <SelectItem key={currency.id} value={String(currency.id)}>
                            {currency.code} — {currency.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Controller
                control={form.control}
                name="isIncludedInBalance"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Checkbox
                      id="account-included"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="account-included">{t('accounts.includedInBalance')}</FieldLabel>
                      <FieldDescription>{t('accounts.includedInBalanceDescription')}</FieldDescription>
                    </FieldContent>
                  </Field>
                )}
              />
            </FieldGroup>
            <DialogFooter className="mt-6">
              {account && canDelete && (
                <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirmingDelete(true)}>
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
      {account && (
        <DeleteAccountDialog
          groupId={groupId}
          account={account}
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          onDeleted={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
