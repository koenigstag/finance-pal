import { currencyCode, distinctLines, folded, plainText } from './notification-text';

describe('plainText', () => {
  it('makes every space plain and every minus a hyphen, and keeps the lines', () => {
    expect(plainText('\u22121\u00a0250\u202f₴\r\nБаланс\u2009: 5')).toBe('-1 250 ₴\nБаланс : 5');
    expect(plainText('\u2013 5')).toBe('- 5');
  });
});

describe('distinctLines', () => {
  it('drops empty lines and the repeat an expanded text brings', () => {
    expect(distinctLines('-30.00 ₴\nАТБ\nБаланс: 1 ₴\n АТБ \nБаланс: 1 ₴\n\n')).toEqual(['-30.00 ₴', 'АТБ', 'Баланс: 1 ₴']);
  });
});

describe('folded', () => {
  it('reads a Latin i as the Cyrillic one, whatever the case', () => {
    expect(folded('Зi своєї картки')).toBe(folded('зі своєї картки'));
  });
});

describe('currencyCode', () => {
  it('knows the hryvnia however it is printed, and takes ISO codes as they are', () => {
    expect(['₴', 'грн', 'грн.', 'UAH'].map(currencyCode)).toEqual(['UAH', 'UAH', 'UAH', 'UAH']);
    expect(currencyCode('HUF')).toBe('HUF');
    expect(currencyCode('huf')).toBeNull();
    expect(currencyCode('$')).toBeNull();
  });
});
