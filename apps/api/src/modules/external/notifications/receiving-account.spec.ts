import { UnprocessableEntityException } from '@nestjs/common';
import { receivingAccount, type ReceivingAccountLike } from './receiving-account';

const UAH = 1;
const USD = 2;
const codes: Record<number, string> = { [UAH]: 'UAH', [USD]: 'USD' };
const codeOf = (currencyId: number) => codes[currencyId];

const account = (id: string, extra: Partial<ReceivingAccountLike> = {}): ReceivingAccountLike => ({
  id,
  archived: false,
  currencyId: UAH,
  notificationBank: 'abank',
  ...extra,
});

const pick = (accounts: ReceivingAccountLike[], currency: string | null) =>
  receivingAccount(accounts, 'abank', currency, codeOf).id;

describe('receivingAccount', () => {
  it("is the account receiving the bank's notifications", () => {
    const accounts = [account('cash', { notificationBank: null }), account('card')];
    expect(pick(accounts, 'UAH')).toBe('card');
    // A notification naming no currency still has only one place to go.
    expect(pick(accounts, null)).toBe('card');
  });

  it('tells apart accounts of one bank by the currency the notification names', () => {
    const accounts = [account('uah'), account('usd', { currencyId: USD })];
    expect(pick(accounts, 'USD')).toBe('usd');
    expect(pick(accounts, 'UAH')).toBe('uah');
  });

  it('leaves archived accounts out', () => {
    expect(pick([account('old', { archived: true }), account('new')], 'UAH')).toBe('new');
  });

  it('asks for the setting when no account receives the bank', () => {
    expect(() => pick([account('cash', { notificationBank: null })], 'UAH')).toThrow(/choose one in the app/);
    expect(() => pick([account('old', { archived: true })], 'UAH')).toThrow(UnprocessableEntityException);
  });

  it('refuses a currency no receiving account is in, rather than recording it in another', () => {
    expect(() => pick([account('card')], 'USD')).toThrow(/is in USD, and no account receiving A-Bank notifications is/);
  });

  it('refuses to pick between accounts it cannot tell apart', () => {
    const accounts = [account('first'), account('second')];
    expect(() => pick(accounts, 'UAH')).toThrow(/2 accounts in UAH receive A-Bank notifications/);
    expect(() => pick([account('uah'), account('usd', { currencyId: USD })], null)).toThrow(/names no currency/);
  });
});
