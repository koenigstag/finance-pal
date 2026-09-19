import { useTranslation } from 'react-i18next';
import type { ExchangeRates } from './queries';

/**
 * When the fetched rates were published, and the credit their provider's terms ask for. Not a
 * nicety: open.er-api requires the credit on screen wherever its rates are, and which provider
 * answered is only known per request, so this renders whatever came back rather than a fixed name.
 */
export function RatesNote({ rates }: { rates: ExchangeRates }) {
  const { t, i18n } = useTranslation();
  // Parsed as UTC midnight, so it is formatted in UTC too — west of Greenwich it would otherwise
  // show the day before.
  const published = new Date(`${rates.publishedOn}T00:00:00Z`).toLocaleDateString(i18n.language, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });

  // One line each rather than joined in a row, so a long credit can't push the date off a phone.
  return (
    <div className="flex flex-col text-xs text-muted-foreground">
      <p className="truncate">{t('common.ratesPublished', { date: published })}</p>
      {rates.attribution && (
        <a href={rates.attribution.url} target="_blank" rel="noreferrer" className="truncate underline">
          {rates.attribution.text}
        </a>
      )}
    </div>
  );
}
