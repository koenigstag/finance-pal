import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCurrencies, useExchangeRates } from '@/features/currencies/queries';
import { manualRatesToKeep } from '@/features/currencies/rates';
import { RatesNote } from '@/features/currencies/rates-note';
import { useProfile, useUpdateProfile } from './queries';

// What the API accepts: a positive decimal, up to eight decimal places.
const RATE_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;

/**
 * Every rate against the main currency, one per currency, used wherever a total has to span
 * currencies. The ones a rate provider quotes are fetched daily and shown locked; the user keeps the
 * rest by hand. Adding a rate is only offered for a currency the provider doesn't quote, since a
 * typed rate never overrides a fetched one (see effectiveRates).
 *
 * If the provider can't be reached at all, nothing is locked: every rate is the user's own again,
 * including any typed before the provider covered its currency.
 */
export function ExchangeRatesCard() {
  const { t } = useTranslation();
  const profile = useProfile();
  const currencies = useCurrencies();
  const exchangeRates = useExchangeRates();
  const updateProfile = useUpdateProfile();
  // Held as typed while editing; only well-formed ones are saved.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState<string | undefined>();

  const base = currencies.data?.find((currency) => currency.id === profile.data?.mainCurrencyId);

  if (profile.isPending || currencies.isPending) {
    return <Spinner className="mx-auto size-6 text-muted-foreground" />;
  }

  if (profile.isError || currencies.isError) {
    return (
      <QueryError
        onRetry={() => {
          void profile.refetch();
          void currencies.refetch();
        }}
      />
    );
  }

  if (!profile.data || !currencies.data || !base) {
    return null;
  }

  // Only an answer quoted against the current main currency counts: right after it changes, the
  // cached one can still be against the old.
  const fetchedAnswer = exchangeRates.data?.base === base.code ? exchangeRates.data : undefined;
  const fetched = fetchedAnswer?.rates ?? {};
  const manual = draft ?? profile.data.exchangeRates ?? {};
  const others = currencies.data.filter((currency) => currency.id !== base.id);

  const fetchedCodes = others.map((currency) => currency.code).filter((code) => code in fetched);
  const manualCodes = Object.keys(manual)
    .filter((code) => !(code in fetched))
    .sort();
  const addable = others.filter((currency) => !(currency.code in fetched) && !(currency.code in manual));
  const invalid = manualCodes.some((code) => !RATE_PATTERN.test(manual[code].trim()));
  const edit = (next: Record<string, string>) => setDraft(next);

  const onSave = () => {
    const kept = manualRatesToKeep(manual, fetched);
    updateProfile.mutate(
      { exchangeRates: Object.keys(kept).length > 0 ? kept : null },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.rates.title')}</CardTitle>
        <CardDescription>{t('settings.rates.description', { code: base.code })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Until the provider has answered, which rates are locked isn't known yet. */}
        {exchangeRates.isPending ? (
          <Spinner />
        ) : (
          <>
            {fetchedCodes.length === 0 && manualCodes.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.rates.empty')}</p>
            )}

            {fetchedCodes.map((code) => (
              <div key={code} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-sm font-medium">1 {code}</span>
                <span className="text-muted-foreground">=</span>
                <Input
                  disabled
                  aria-label={t('settings.rates.fetchedRate', { code, base: base.code })}
                  value={fetched[code]}
                />
                <span className="w-12 shrink-0 text-sm text-muted-foreground">{base.code}</span>
                {/* Where a hand-kept rate has its remove button, so the columns line up. */}
                <span aria-hidden className="size-10 shrink-0 md:size-8" />
              </div>
            ))}

            {manualCodes.map((code) => (
              <div key={code} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-sm font-medium">1 {code}</span>
                <span className="text-muted-foreground">=</span>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={t('settings.rates.rate', { code, base: base.code })}
                  aria-invalid={!RATE_PATTERN.test(manual[code].trim())}
                  value={manual[code]}
                  onChange={(event) => edit({ ...manual, [code]: event.target.value })}
                />
                <span className="w-12 shrink-0 text-sm text-muted-foreground">{base.code}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('settings.rates.remove', { code })}
                  onClick={() => {
                    const { [code]: _removed, ...rest } = manual;
                    edit(rest);
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            ))}

            {/* With the provider quoting every currency there is, there's nothing left to add. */}
            {addable.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={adding ?? ''} onValueChange={setAdding}>
                  <SelectTrigger className="flex-1 [&_[data-hint]]:hidden" aria-label={t('settings.rates.add')}>
                    <SelectValue placeholder={t('settings.rates.add')} />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((currency) => (
                      <SelectItem key={currency.id} value={currency.code}>
                        {/* The closed select shows only the code; the name is for the list. */}
                        <span className="flex flex-col">
                          <span>{currency.code}</span>
                          <span data-hint className="text-xs text-muted-foreground">{currency.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={!adding}
                  onClick={() => {
                    if (adding) {
                      edit({ ...manual, [adding]: '' });
                      setAdding(undefined);
                    }
                  }}
                >
                  <PlusIcon />
                  {t('settings.rates.addAction')}
                </Button>
              </div>
            )}
          </>
        )}

        {updateProfile.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}

        {/* Only once there is something of the user's own to save: a card of locked rates has none. */}
        {(manualCodes.length > 0 || draft !== null) && (
          <Button disabled={draft === null || invalid || updateProfile.isPending} onClick={onSave}>
            {updateProfile.isPending && <Spinner />}
            {t('common.save')}
          </Button>
        )}

        {fetchedAnswer && fetchedCodes.length > 0 && <RatesNote rates={fetchedAnswer} />}
        {exchangeRates.isError && <p className="text-xs text-muted-foreground">{t('settings.rates.unavailable')}</p>}
      </CardContent>
    </Card>
  );
}
