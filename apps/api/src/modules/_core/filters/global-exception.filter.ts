import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { RequestValidationError } from '@ts-rest/nest';
import type { Response } from 'express';

// Known HttpExceptions pass their status/body through as-is; anything unexpected is logged
// server-side and reduced to a generic 500 — the client never sees internal error details.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof RequestValidationError) {
      // Added to ts-rest's own body, not in place of it: the web app reads the issues field by field.
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: describeValidationError(exception),
        ...(exception.getResponse() as object),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}

/**
 * ts-rest reports a request that doesn't fit its contract as a list of issues per part of the
 * request, with no message of its own. The first issue becomes one, so every error body carries
 * `message` — the one field a client without a parser for the rest, a phone automation say, can
 * show its user.
 */
export function describeValidationError(error: RequestValidationError): string {
  if (error.body?.issues.some((issue) => issue.path.length === 0 && issue.code === 'invalid_type' && issue.received === 'undefined')) {
    // What a client that forgot its Content-Type sends: the body never got parsed.
    return 'The request needs a JSON body, sent with Content-Type: application/json';
  }
  for (const part of [error.body, error.query, error.pathParams, error.headers]) {
    const issue = part?.issues[0];
    if (issue) {
      return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
    }
  }
  return 'Invalid request';
}
