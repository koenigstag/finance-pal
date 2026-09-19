/**
 * Turning a date and a time somebody picked into the moment they meant, and back again.
 *
 * The two inputs are read in the device's own zone — that is what a date and a time typed into a
 * browser mean — so the instant follows from them without any zone arithmetic here. The zone is
 * sent along with it so the app can show back the time that was chosen: 09:00 picked in Kyiv
 * reads as 09:00 on a laptop in Berlin, where the same instant is 08:00.
 */

/** The instant "2026-10-14" and "09:00" mean here, or null if either is missing or unreadable. */
export function toInstant(date: string, time: string): string | null {
  if (!date || !time) {
    return null;
  }
  // No offset in the string, so this is read as local time — the one place that matters.
  const moment = new Date(`${date}T${time}`);
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}

/** The moment as it was picked: in the zone it was picked in, in the reader's language. */
export function formatScheduledAt(sendAt: string, timezone: string, locale: string): string {
  const moment = new Date(sendAt);
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(moment);
  } catch {
    // A zone this browser doesn't know (an old name, a typo in an old row): the device's own.
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(moment);
  }
}

/** What the form starts on: tomorrow morning, which is what most notes are for. */
export function defaultSchedule(now: Date): { date: string; time: string } {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return { date: `${tomorrow.getFullYear()}-${month}-${day}`, time: '09:00' };
}
