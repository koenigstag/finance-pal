import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './errors';

describe('toApiError', () => {
  it('reads a Nest exception body', () => {
    const error = toApiError(409, { statusCode: 409, message: 'Already a member of this group', error: 'Conflict' });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Already a member of this group');
    expect(error.fieldErrors).toEqual({});
  });

  it('joins a Nest message list', () => {
    expect(toApiError(400, { statusCode: 400, message: ['first', 'second'] }).message).toBe('first\nsecond');
  });

  it('maps ts-rest body validation issues to field errors', () => {
    const error = toApiError(400, {
      paramsResult: null,
      headersResult: null,
      queryResult: null,
      bodyResult: {
        name: 'ZodError',
        issues: [
          { path: ['amount'], message: 'invalid money format' },
          { path: ['tagIds', 0], message: 'Invalid uuid' },
          { path: ['amount'], message: 'a second amount issue' },
        ],
      },
    });

    expect(error.status).toBe(400);
    expect(error.message).toBe('invalid money format');
    // The first issue per field wins.
    expect(error.fieldErrors).toEqual({ amount: 'invalid money format', 'tagIds.0': 'Invalid uuid' });
  });

  it('reports query and param issues without treating them as form fields', () => {
    const error = toApiError(400, {
      paramsResult: { name: 'ZodError', issues: [{ path: ['groupId'], message: 'Invalid uuid' }] },
      headersResult: null,
      queryResult: null,
      bodyResult: null,
    });

    expect(error.message).toBe('Invalid uuid');
    expect(error.fieldErrors).toEqual({});
  });

  it('falls back to a generic message for an unknown body', () => {
    expect(toApiError(502, '<html>Bad gateway</html>').message).toBe('Request failed with status 502');
    expect(toApiError(500, null).message).toBe('Request failed with status 500');
  });
});
