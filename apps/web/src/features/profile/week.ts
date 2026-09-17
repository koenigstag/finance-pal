// startDayOfWeek follows Date.getDay() and date-fns' weekStartsOn: 0 = Sunday … 6 = Saturday.

/** Localized weekday names indexed by startDayOfWeek, capitalized for use as option labels. */
export function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => {
    const name = format.format(Date.UTC(2024, 0, 7 + day));
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  });
}

interface WeekInfo {
  // 1 = Monday … 7 = Sunday, per Intl.Locale.
  firstDay: number;
}

type LocaleWithWeekInfo = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/** The locale's customary first day of the week, defaulting to Monday where it's unknown. */
export function detectStartDayOfWeek(locale: string): number {
  try {
    const intlLocale = new Intl.Locale(locale) as LocaleWithWeekInfo;
    // getWeekInfo() is the standard; older engines exposed a weekInfo getter instead.
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info) {
      return info.firstDay % 7;
    }
  } catch {
    // An invalid locale tag: fall through to the default.
  }
  return 1;
}
