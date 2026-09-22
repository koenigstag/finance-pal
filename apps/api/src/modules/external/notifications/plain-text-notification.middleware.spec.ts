import type { Request, Response } from 'express';
import { PlainTextNotificationMiddleware } from './plain-text-notification.middleware';

function run(request: { body: unknown; query: Record<string, unknown> }) {
  const next = jest.fn();
  new PlainTextNotificationMiddleware().use(request as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return request.body;
}

describe('PlainTextNotificationMiddleware', () => {
  it('reads a bare text body as the text, and the query string as the bank', () => {
    const text = 'Покупка "Сільпо"\nБаланс: 1 250,50 ₴';
    expect(run({ body: text, query: { type: 'abank' } })).toEqual({ type: 'abank', text });
  });

  it('leaves the bank missing when the query string names none, for the contract to refuse', () => {
    expect(run({ body: 'text', query: {} })).toEqual({ type: undefined, text: 'text' });
  });

  it('leaves a JSON body as it is', () => {
    const body = { type: 'abank', text: 'text' };
    expect(run({ body, query: { type: 'other' } })).toBe(body);
  });
});
