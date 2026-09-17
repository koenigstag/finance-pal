import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { profileSchema } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { weekdayNames } from './week';

// The contract's profile, with the fields onboarding requires made required and the language
// narrowed to the ones the UI ships.
const profileFormSchema = profileSchema
  .extend({
    displayName: z.string().trim().min(1).max(80),
    startDayOfWeek: z.number().int().min(0).max(6),
    language: z.enum(SUPPORTED_LANGUAGES),
  })
  // Exchange rates belong to the profile but are edited in their own card, not this form.
  .omit({ exchangeRates: true });

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

// Each language named in itself, so it's recognizable whatever the UI is currently in.
const LANGUAGE_NAMES: Record<ProfileFormValues['language'], string> = {
  en: 'English',
  ru: 'Русский',
};

interface Currency {
  id: number;
  code: string;
  name: string;
}

interface ProfileFormProps {
  defaultValues: ProfileFormValues;
  currencies: Currency[];
  submitLabel: string;
  onSubmit: (values: ProfileFormValues) => Promise<unknown>;
  // Rendered under the submit button, e.g. a "saved" confirmation.
  footer?: (state: { isDirty: boolean }) => ReactNode;
  // The currency a language implies. When given, picking a language also picks that currency,
  // as long as the currency hasn't been chosen by hand — for first-time setup, where both are
  // still guesses. Settings leaves it out: switching the UI language there shouldn't touch money.
  currencyForLanguage?: (language: ProfileFormValues['language']) => number | undefined;
}

export function ProfileForm({ defaultValues, currencies, submitLabel, onSubmit, footer, currencyForLanguage }: ProfileFormProps) {
  const { t, i18n } = useTranslation();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues,
  });
  const weekdays = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      // The saved values become the new baseline, so isDirty tracks changes since the save.
      form.reset(values);
    } catch {
      form.setError('root', { message: t('errors.generic') });
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        {errors.root?.message && (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        <Field data-invalid={!!errors.displayName}>
          <FieldLabel htmlFor="displayName">{t('profile.displayName')}</FieldLabel>
          <Input
            id="displayName"
            autoComplete="nickname"
            aria-invalid={!!errors.displayName}
            {...form.register('displayName')}
          />
          <FieldError errors={[errors.displayName]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="mainCurrencyId">{t('profile.mainCurrency')}</FieldLabel>
          <Controller
            control={form.control}
            name="mainCurrencyId"
            render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <SelectTrigger id="mainCurrencyId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.id} value={String(currency.id)}>
                      {currency.code} — {currency.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="startDayOfWeek">{t('profile.startDayOfWeek')}</FieldLabel>
          <Controller
            control={form.control}
            name="startDayOfWeek"
            render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <SelectTrigger id="startDayOfWeek" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekdays.map((name, day) => (
                    <SelectItem key={day} value={String(day)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="language">{t('profile.language')}</FieldLabel>
          <Controller
            control={form.control}
            name="language"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  const currencyId = currencyForLanguage?.(value as ProfileFormValues['language']);
                  if (currencyId !== undefined && !form.getFieldState('mainCurrencyId').isDirty) {
                    form.setValue('mainCurrencyId', currencyId);
                  }
                }}
              >
                <SelectTrigger id="language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <SelectItem key={language} value={language}>
                      {LANGUAGE_NAMES[language]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
        {footer?.({ isDirty: form.formState.isDirty })}
      </FieldGroup>
    </form>
  );
}
