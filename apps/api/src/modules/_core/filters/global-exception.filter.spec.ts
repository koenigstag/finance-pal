import { RequestValidationError } from '@ts-rest/nest';
import { z } from 'zod';
import { describeValidationError } from './global-exception.filter';

const bodySchema = z.object({ amount: z.string(), note: z.string() });

describe('describeValidationError', () => {
  it("names the field of the body's first issue", () => {
    const body = bodySchema.safeParse({ amount: 12 }).error ?? null;
    expect(describeValidationError(new RequestValidationError(null, null, null, body))).toBe(
      'amount: Expected string, received number',
    );
  });

  it('says so when there was no body to read', () => {
    const body = bodySchema.safeParse(undefined).error ?? null;
    expect(describeValidationError(new RequestValidationError(null, null, null, body))).toMatch(/Content-Type: application\/json/);
  });

  it('falls back to the query and the path', () => {
    const query = z.object({ limit: z.coerce.number().max(200) }).safeParse({ limit: '500' }).error ?? null;
    expect(describeValidationError(new RequestValidationError(null, null, query, null))).toMatch(/^limit: /);
  });
});
