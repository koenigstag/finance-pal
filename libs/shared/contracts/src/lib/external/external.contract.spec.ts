import { externalAmountSchema, externalContract } from './external.contract.js';

describe('externalAmountSchema', () => {
  it.each([
    ['125.50', '125.50'],
    ['1 250,50', '1250.50'],
    [' 7 ', '7'],
    [125.5, '125.5'],
    [12, '12'],
  ])('reads %j as %j', (input, expected) => {
    expect(externalAmountSchema.parse(input)).toBe(expected);
  });

  it.each(['-5', -5, '1.234', '1,234.50', 'abc', '', 1e21])('refuses %j', (input) => {
    expect(externalAmountSchema.safeParse(input).success).toBe(false);
  });
});

describe('externalContract', () => {
  it('puts every route under the versioned prefix', () => {
    expect(externalContract.key.path).toBe('/api/external/v1/key');
    expect(externalContract.transactions.create.path).toBe('/api/external/v1/transactions');
    expect(externalContract.accounts.update.path).toBe('/api/external/v1/accounts/:accountId');
  });

  it('reads a notification-style body', () => {
    const body = externalContract.transactions.create.body.parse({
      type: 'expense',
      amount: '1 250,50',
      accountName: '  Monobank ',
      note: 'Coffee',
    });
    expect(body).toEqual({ type: 'expense', amount: '1250.50', accountName: 'Monobank', note: 'Coffee' });
  });

  it("doesn't let an update change the type", () => {
    const body = externalContract.transactions.update.body.parse({ type: 'income', amount: '3' });
    expect(body).toEqual({ amount: '3' });
  });
});
