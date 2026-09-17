import { z } from 'zod';

// Not Intl.supportedValuesOf('timeZone'): that list holds canonical names only, so it rejects
// "UTC" itself and current spellings like "Europe/Kyiv". Constructing a formatter accepts
// exactly the zone names the runtime can actually compute with.
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().refine(isValidTimezone, 'invalid IANA time zone');
