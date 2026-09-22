import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { CurrencyCodes, type ExternalLookupService } from '../external-lookup.service';
import type { ExternalTransactionsService } from '../external-transactions.service';
import { ExternalNotificationsService, notificationKey } from './external-notifications.service';
import { NOTIFICATION_PARSERS } from './notification-parsers';
import type { ReceivingAccountLike } from './receiving-account';

jest.mock('./notification-parsers', () => ({ NOTIFICATION_PARSERS: { abank: jest.fn() } }));
const parse = NOTIFICATION_PARSERS.abank as jest.Mock;

const apiKey = { id: 'key-1', userId: 'user-1', groupId: 'group-1', scopes: ['transactions:create'] };
const card: ReceivingAccountLike = { id: 'card', archived: false, currencyId: 1, notificationBank: 'abank' };

function serviceWith(accounts: ReceivingAccountLike[] = [card]) {
  const create = jest.fn().mockResolvedValue({ transaction: { id: 'transaction-1' }, replayed: false });
  const lookup = {
    accountsOf: jest.fn().mockResolvedValue(accounts),
    currencyCodes: jest.fn().mockResolvedValue(new CurrencyCodes(new Map([[1, 'UAH']]))),
  };
  const service = new ExternalNotificationsService(
    { create } as unknown as ExternalTransactionsService,
    lookup as unknown as ExternalLookupService,
  );
  return { service, create, lookup };
}

describe('ExternalNotificationsService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    parse.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('records a payment on the account receiving the bank, keyed by the text', async () => {
    parse.mockReturnValue({ kind: 'movement', type: 'expense', amount: '125.50', currency: 'UAH', counterparty: 'Сільпо' });
    const { service, create } = serviceWith();

    const result = await service.forward(apiKey, { type: 'abank', text: 'Покупка 125,50 UAH Сільпо' });

    expect(result).toEqual({ recorded: true, transaction: { id: 'transaction-1' }, replayed: false });
    expect(create).toHaveBeenCalledWith(
      apiKey,
      { type: 'expense', amount: '125.50', accountId: 'card', note: 'Сільпо' },
      notificationKey('abank', 'Покупка 125,50 UAH Сільпо'),
    );
  });

  it('leaves the note out when the bank names nobody', async () => {
    parse.mockReturnValue({ kind: 'movement', type: 'income', amount: '500', currency: null, counterparty: null });
    const { service, create } = serviceWith();

    await service.forward(apiKey, { type: 'abank', text: 'Зарахування 500 UAH' });

    expect(create.mock.calls[0][1]).toEqual({ type: 'income', amount: '500', accountId: 'card', note: undefined });
  });

  it('records nothing for a notification that moves no money, and logs why without the text', async () => {
    parse.mockReturnValue({ kind: 'skip', reason: 'A one-time code' });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service, create, lookup } = serviceWith();

    await expect(service.forward(apiKey, { type: 'abank', text: 'Код: 1234' })).resolves.toEqual({
      recorded: false,
      reason: 'A one-time code',
    });
    expect(lookup.accountsOf).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Skipped abank notification (key key-1): A one-time code');
    expect(log.mock.calls.flat().join(' ')).not.toContain('1234');
    log.mockRestore();
  });

  it('refuses text it cannot read, naming the bank', async () => {
    parse.mockReturnValue(null);
    const { service, create } = serviceWith();

    const forwarding = service.forward(apiKey, { type: 'abank', text: 'Something new' });
    await expect(forwarding).rejects.toThrow(UnprocessableEntityException);
    await expect(forwarding).rejects.toThrow(/A-Bank notification/);
    expect(create).not.toHaveBeenCalled();
  });

  it('logs the whole text it cannot read, line breaks visible, so the parser can be taught it', async () => {
    parse.mockReturnValue(null);
    const { service } = serviceWith();

    await expect(service.forward(apiKey, { type: 'abank', text: '🛒 -1 ₴\nАТБ' })).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith('Unread abank notification (key key-1): "🛒 -1 ₴\\nАТБ"');
  });

  it('never logs a text it reads', async () => {
    parse.mockReturnValue({ kind: 'movement', type: 'expense', amount: '1', currency: 'UAH', counterparty: null });
    const { service } = serviceWith();

    await service.forward(apiKey, { type: 'abank', text: 'Покупка 1 UAH' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a payment when no account receives the bank', async () => {
    parse.mockReturnValue({ kind: 'movement', type: 'expense', amount: '1', currency: 'UAH', counterparty: null });
    const { service, create } = serviceWith([{ ...card, notificationBank: null }]);

    await expect(service.forward(apiKey, { type: 'abank', text: 'Покупка 1 UAH' })).rejects.toThrow(/No account receives/);
    expect(create).not.toHaveBeenCalled();
    // The reason reaches the log, the text doesn't.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Unrecorded abank notification \(key key-1\): No account receives/));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('Покупка');
  });
});

describe('notificationKey', () => {
  it('is the same for a copy that differs only in line endings or surrounding space', () => {
    expect(notificationKey('abank', 'Покупка\r\nБаланс 10 UAH ')).toBe(notificationKey('abank', 'Покупка\nБаланс 10 UAH'));
  });

  it("keeps apart different banks' texts and keys clients choose themselves", () => {
    expect(notificationKey('abank', 'text')).toBe('notification:abank:text');
  });
});
