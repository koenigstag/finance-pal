import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCurrencies } from '@/features/currencies/queries';
import { useProfile, useUpdateProfile } from './queries';

// What the API accepts: a positive decimal, up to eight decimal places.
const RATE_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;

/**
 * Rates the user keeps by hand, one per currency against their main one, used wherever a total
 * has to span currencies. Nothing fetches them yet — see the note in the card — so they are as
 * current as the day they were typed.
 */
export function ExchangeRatesCard() {
  const { t } = useTranslation();
  const profile = useProfile();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();
  // Held as typed while editing; only well-formed ones are saved.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState<string | undefined>();

  const base = currencies.data?.find((currency) => currency.id === profile.data?.mainCurrencyId);
  const rates = draft ?? profile.data?.exchangeRates ?? {};
  const edit = (next: Record<string, string>) => setDraft(next);
  const codes = Object.keys(rates).sort();
  const invalid = Object.values(rates).some((rate) => !RATE_PATTERN.test(rate.trim()));

  if (!profile.data || !currencies.data || !base) {
    return null;
  }

  const onSave = () => {
    const cleaned = Object.fromEntries(Object.entries(rates).map(([code, rate]) => [code, rate.trim()]));
    updateProfile.mutate(
      { exchangeRates: Object.keys(cleaned).length > 0 ? cleaned : null },
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
        {codes.length === 0 && <p className="text-sm text-muted-foreground">{t('settings.rates.empty')}</p>}

        {codes.map((code) => (
          <div key={code} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm font-medium">1 {code}</span>
            <span className="text-muted-foreground">=</span>
            <Input
              inputMode="decimal"
              autoComplete="off"
              aria-label={t('settings.rates.rate', { code, base: base.code })}
              aria-invalid={!RATE_PATTERN.test(rates[code].trim())}
              value={rates[code]}
              onChange={(event) => edit({ ...rates, [code]: event.target.value })}
            />
            <span className="w-12 shrink-0 text-sm text-muted-foreground">{base.code}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings.rates.remove', { code })}
              onClick={() => {
                const { [code]: _removed, ...rest } = rates;
                edit(rest);
              }}
            >
              <XIcon />
            </Button>
          </div>
        ))}

        <div className="flex items-center gap-2">
          <Select value={adding ?? ''} onValueChange={setAdding}>
            <SelectTrigger className="flex-1" aria-label={t('settings.rates.add')}>
              <SelectValue placeholder={t('settings.rates.add')} />
            </SelectTrigger>
            <SelectContent>
              {currencies.data
                .filter((currency) => currency.id !== base.id && !(currency.code in rates))
                .map((currency) => (
                  <SelectItem key={currency.id} value={currency.code}>
                    {currency.code} · {currency.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!adding}
            onClick={() => {
              if (adding) {
                edit({ ...rates, [adding]: '' });
                setAdding(undefined);
              }
            }}
          >
            <PlusIcon />
            {t('settings.rates.addAction')}
          </Button>
        </div>

        {updateProfile.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}

        <Button disabled={draft === null || invalid || updateProfile.isPending} onClick={onSave}>
          {updateProfile.isPending && <Spinner />}
          {t('common.save')}
        </Button>

        {/* Until something fetches rates, they are only as good as the last time they were typed. */}
        <p className="text-xs text-muted-foreground">{t('settings.rates.note')}</p>
      </CardContent>
    </Card>
  );
}
