import { parseABankNotification as parse } from './abank';

// As a phone automation forwards one: the title, the text, then the expanded text, which A-Bank's
// notifications repeat the text in. Balances here are made up; the wording is A-Bank's own.
const forwarded = (title: string, text: string, expanded = text) => [title, text, expanded].join('\n');

const expense = (amount: string, counterparty: string | null, currency = 'UAH') => ({
  kind: 'movement',
  type: 'expense',
  amount,
  currency,
  counterparty,
});

describe('parseABankNotification', () => {
  it('reads a purchase: the signed amount in the title, the shop, cashback and the balance after', () => {
    expect(parse(forwarded('🛒 -133.40 ₴', 'АТБ\nКешбек: 1.6 ₴\nБаланс: 5 757.11 ₴'))).toEqual(expense('133.40', 'АТБ'));
  });

  it('reads money coming in, keeping the name as the bank prints it', () => {
    // "Заробiтна" comes with a Latin i.
    expect(parse(forwarded('💰 +1 332.10 ₴', 'Заробiтна плата\nБаланс: 15 072.63 ₴'))).toEqual({
      kind: 'movement',
      type: 'income',
      amount: '1332.10',
      currency: 'UAH',
      counterparty: 'Заробiтна плата',
    });
  });

  it('reads a title without an emoji', () => {
    expect(parse(forwarded(' -108.00 ₴', 'Bolt\nБаланс: 499.70 ₴'))).toEqual(expense('108.00', 'Bolt'));
  });

  it('reads the text as a single line too, the name before its figures', () => {
    expect(parse('🛒 -133.40 ₴\nАТБ Кешбек: 1.6 ₴ Баланс: 5 757.11 ₴')).toEqual(expense('133.40', 'АТБ'));
    expect(parse("🍸 -4 280.00 HUF\nРесторан MCD KISVA'RDA Баланс: 7 204.78 ₴ Курс 0.1456  ₴/HUF")).toEqual(
      expense('4280.00', "Ресторан MCD KISVA'RDA", 'HUF'),
    );
  });

  it('reads a purchase abroad in its own currency, which the account then has to be in', () => {
    expect(parse(forwarded('🍸 -4 280.00 HUF', "Ресторан MCD KISVA'RDA\nБаланс: 7 204.78 ₴\nКурс 0.1456  ₴/HUF"))).toEqual(
      expense('4280.00', "Ресторан MCD KISVA'RDA", 'HUF'),
    );
  });

  it('reads no-break spaces, a real minus sign and a decimal comma', () => {
    expect(parse(forwarded('🛒 \u22121\u00a0250,00\u00a0₴', 'Сільпо\nБаланс: 3\u00a0000,00 ₴'))).toEqual(expense('1250.00', 'Сільпо'));
  });

  it('finds the title wherever it is, for a client that sends the text first', () => {
    expect(parse('АТБ\nБаланс: 5.00 ₴\n🛒 -1.00 ₴')).toEqual(expense('1.00', 'АТБ'));
  });

  it('names nobody when the text only has figures', () => {
    expect(parse(forwarded('+50.00 ₴', 'Баланс: 80.00 ₴'))).toEqual({
      kind: 'movement',
      type: 'income',
      amount: '50.00',
      currency: 'UAH',
      counterparty: null,
    });
  });

  it('records nothing for money moved between your own cards, either side', () => {
    const skip = { kind: 'skip', reason: 'A move between your own cards' };
    expect(parse(forwarded('-30.00 ₴', 'На свою картку\nБаланс: 1 000.00 ₴'))).toEqual(skip);
    // A Latin i, as A-Bank writes it, and a Cyrillic one.
    expect(parse(forwarded('+30.00 ₴', 'Зi своєї картки\nБаланс: 30.52 ₴'))).toEqual(skip);
    expect(parse(forwarded('+30.00 ₴', 'Зі своєї картки\nБаланс: 30.52 ₴'))).toEqual(skip);
  });

  it('records nothing for a declined payment', () => {
    expect(parse(forwarded('-100.00 ₴', 'Відмова: недостатньо коштів\nБаланс: 20.00 ₴'))).toEqual({
      kind: 'skip',
      reason: 'A declined payment',
    });
  });

  it("doesn't guess at what it doesn't know", () => {
    // No balance after it: not one of the notifications a payment posts.
    expect(parse(forwarded('-100.00 ₴', 'Щось нове'))).toBeNull();
    // The title alone.
    expect(parse('🛒 -133.40 ₴')).toBeNull();
    // An older format, with no sign to say which way the money went.
    expect(parse('🛒 147.57UAH Uber *736 17:16 Бал. 9651.35UAH')).toBeNull();
    // Not about money at all.
    expect(parse(forwarded('А-Банк', 'Ваша картка готова'))).toBeNull();
    // Nothing moved.
    expect(parse(forwarded('-0.00 ₴', 'Перевірка картки\nБаланс: 10.00 ₴'))).toBeNull();
  });
});
