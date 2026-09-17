import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ACCOUNT_TYPES, accountsContract } from '@ft/shared-contracts';
import { ACCOUNT_ICON_NAMES, defaultAppearance } from '@/components/appearance/appearance';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { ColorPicker, IconPicker } from '@/components/appearance/appearance-picker';
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
import { FavouriteToggle } from './favourite-toggle';
import { useSaveAccount, type Account } from './queries';

const accountFormSchema = accountsContract.create.body.extend({
  name: z.string().trim().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  isIncludedInBalance: z.boolean(),
  isFavourite: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

interface AccountDialogProps {
  groupId: string;
  // The account to edit; absent to create one.
  account?: Account;
  // How many accounts the group has, to suggest the next palette color for a new one.
  accountCount?: number;
  // Whether this account is the default for new transactions without being starred (it's first
  // and no account is): its star shows filled all the same.
  implicitFavourite?: boolean;
  // Whether the caller may delete the account being edited.
  canDelete?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDialog({
  groupId,
  account,
  accountCount = 0,
  implicitFavourite = false,
  canDelete = false,
  open,
  onOpenChange,
}: AccountDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const profile = useProfile();
  const saveAccount = useSaveAccount(groupId);
  const form = useForm<AccountFormValues>({ resolver: zodResolver(accountFormSchema) });
  const errors = form.formState.errors;
  const [previewName, previewIcon, previewColor] = useWatch({ control: form.control, name: ['name', 'icon', 'color'] });

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
              isFavourite: account.isFavourite,
              icon: account.icon,
              color: account.color,
            }
          : {
              name: '',
              type: 'regular',
              currencyId: profile.data?.mainCurrencyId ?? currencies.data?.[0]?.id ?? 1,
              isIncludedInBalance: true,
              isFavourite: false,
              ...defaultAppearance(undefined, accountCount, 'wallet'),
            },
      );
    }
  }, [open, account, accountCount, form, profile.data, currencies.data]);

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
          {/* How the account will look in lists, as it's being edited, with its favourite star. */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 py-1 pr-1 pl-3">
            <div className="flex min-w-0 flex-1 items-center gap-3" aria-hidden>
              <AppearanceIcon icon={previewIcon} color={previewColor} fallbackIcon="wallet" />
              <span className="truncate font-medium">{previewName?.trim() || t('accounts.name')}</span>
            </div>
            <Controller
              control={form.control}
              name="isFavourite"
              render={({ field }) => (
                // Unstarring hands the default back to the first account; starring the first account
                // while it's only the default saves it, so reordering accounts won't move the default.
                <FavouriteToggle favourite={field.value || implicitFavourite} onToggle={() => field.onChange(!field.value)} />
              )}
            />
          </div>
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
              <Field>
                <FieldLabel htmlFor="account-color">{t('accounts.color')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <ColorPicker id="account-color" label={t('accounts.color')} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="account-icon">{t('accounts.icon')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <IconPicker
                      id="account-icon"
                      label={t('accounts.icon')}
                      names={ACCOUNT_ICON_NAMES}
                      value={field.value}
                      color={previewColor}
                      onChange={field.onChange}
                    />
                  )}
                />
              </Field>
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
