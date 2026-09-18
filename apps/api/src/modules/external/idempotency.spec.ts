import { BadRequestException } from '@nestjs/common';
import { hashIdempotencyKey, idempotencyKeyOf, movementFingerprint } from './idempotency';

describe('idempotencyKeyOf', () => {
  it('takes the header or the body field', () => {
    expect(idempotencyKeyOf('abc', undefined)).toBe('abc');
    expect(idempotencyKeyOf(undefined, 'abc')).toBe('abc');
    expect(idempotencyKeyOf('abc', 'abc')).toBe('abc');
    expect(idempotencyKeyOf(undefined, undefined)).toBeUndefined();
  });

  it('refuses two different keys', () => {
    expect(() => idempotencyKeyOf('abc', 'abd')).toThrow(BadRequestException);
  });
});

describe('hashIdempotencyKey', () => {
  it('keeps a digest of any text, never the text', () => {
    const hash = hashIdempotencyKey('Покупка 1 250,50 UAH, Сільпо');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotencyKey('Покупка 1 250,50 UAH, Сільпо')).toBe(hash);
  });
});

describe('movementFingerprint', () => {
  const coffee = { type: 'expense', amount: '12.50', accountName: 'Card' };

  it('reads a repeat as the same request', () => {
    expect(movementFingerprint({ type: 'expense', amount: '12.5', accountName: ' card ' })).toBe(movementFingerprint(coffee));
  });

  it('tells a different amount, account or kind apart', () => {
    const original = movementFingerprint(coffee);
    expect(movementFingerprint({ ...coffee, amount: '13.50' })).not.toBe(original);
    expect(movementFingerprint({ ...coffee, accountName: 'Wallet' })).not.toBe(original);
    expect(movementFingerprint({ ...coffee, type: 'income' })).not.toBe(original);
    expect(movementFingerprint({ ...coffee, toAccountName: 'Wallet', type: 'transfer' })).not.toBe(original);
  });

  it("doesn't mix up an id with a name", () => {
    expect(movementFingerprint({ type: 'expense', amount: '1', accountId: 'card' })).not.toBe(
      movementFingerprint({ type: 'expense', amount: '1', accountName: 'card' }),
    );
  });
});
