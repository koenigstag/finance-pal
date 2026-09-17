import { z } from 'zod';

// Query strings only carry text. z.coerce.boolean() runs Boolean(value), and Boolean('false')
// is true, so ?includeArchived=false would have meant "include". Accept exactly the two
// spellings a client sends and map them explicitly.
export const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');
