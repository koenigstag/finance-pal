interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

// ts-rest's request validation failure: a 400 whose body carries one ZodError per request part.
interface RequestValidationBody {
  paramsResult: { issues: ZodIssueLike[] } | null;
  headersResult: { issues: ZodIssueLike[] } | null;
  queryResult: { issues: ZodIssueLike[] } | null;
  bodyResult: { issues: ZodIssueLike[] } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Body-field path ("amount", "tagIds.0") → message, for putting errors next to form inputs.
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRequestValidationBody(body: unknown): body is RequestValidationBody {
  return typeof body === 'object' && body !== null && 'bodyResult' in body && 'queryResult' in body;
}

/**
 * The API answers errors in two shapes: Nest exceptions as { statusCode, message, error? }
 * (message may be a string or a list), and ts-rest request validation as
 * { paramsResult, headersResult, queryResult, bodyResult } holding Zod issues.
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (isRequestValidationBody(body)) {
    const fieldErrors: Record<string, string> = {};
    const messages: string[] = [];
    for (const part of [body.bodyResult, body.queryResult, body.paramsResult, body.headersResult]) {
      for (const issue of part?.issues ?? []) {
        messages.push(issue.message);
        if (part === body.bodyResult && issue.path.length > 0) {
          fieldErrors[issue.path.join('.')] ??= issue.message;
        }
      }
    }
    return new ApiError(status, messages[0] ?? 'Invalid request', fieldErrors);
  }

  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown };
    if (Array.isArray(message)) {
      return new ApiError(status, message.map(String).join('\n'));
    }
    if (typeof message === 'string') {
      return new ApiError(status, message);
    }
  }

  return new ApiError(status, `Request failed with status ${status}`);
}
