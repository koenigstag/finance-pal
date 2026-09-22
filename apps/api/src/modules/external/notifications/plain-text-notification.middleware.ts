import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Lets a forwarded notification come as its bare text: a text/plain body, with the bank in the
 * query string (POST /notifications?type=abank). A phone automation can't be relied on to put a
 * notification into JSON — MacroDroid has no way to escape one piece of magic text, and a bank's
 * notification is full of line breaks, and often quotes — while the text alone needs no escaping
 * at all. The body is reshaped into the JSON one here, before the contract validates it, so
 * everything after sees one kind of request. main.ts has text/plain bodies read as strings.
 */
@Injectable()
export class PlainTextNotificationMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: () => void): void {
    if (typeof request.body === 'string') {
      request.body = { type: request.query.type, text: request.body };
    }
    next();
  }
}
