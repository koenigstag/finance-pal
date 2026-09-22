import { CsvProblem, decodeCsv, encodeCsv, encodeTableCsv, guardFormula } from './csv';
import { CATEGORIES, TRANSACTIONS } from './tables';

describe('encodeCsv / decodeCsv', () => {
  it('round-trips what needs quoting', () => {
    const rows = [
      ['Name', 'Note'],
      ['Кэш, наличные', 'Said "hi"'],
      ['Two\r\nlines', ' spaced '],
      ['', 'last'],
    ];
    expect(decodeCsv(encodeCsv(rows))).toEqual(rows);
  });

  it('marks the file as UTF-8 for spreadsheets, and ends every line in CRLF', () => {
    const bytes = encodeCsv([['a', 'b']]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('a,b\r\n');
  });

  it('reads what a spreadsheet set to a decimal-comma language saves', () => {
    // Semicolons between fields, and Windows-1251 without a byte order mark.
    const bytes = windows1251('Дата;Сумма\r\n21.09.2026;1250,50\r\n');
    expect(decodeCsv(bytes)).toEqual([
      ['Дата', 'Сумма'],
      ['21.09.2026', '1250,50'],
    ]);
  });

  it('reads UTF-16 "Unicode text", tab-separated', () => {
    const text = 'Name\tCurrency\nГаманець\tUAH\n';
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeCsv(bytes)).toEqual([
      ['Name', 'Currency'],
      ['Гаманець', 'UAH'],
    ]);
  });

  it('honours the delimiter Excel names on a line of its own', () => {
    expect(decodeCsv(Buffer.from('sep=;\na;b,c\n'))).toEqual([['a', 'b,c']]);
  });

  it('keeps a quote inside an unquoted field, and refuses one never closed', () => {
    expect(decodeCsv(Buffer.from('24" monitor,1\n'))).toEqual([['24" monitor', '1']]);
    expect(() => decodeCsv(Buffer.from('a,"never closed\n'))).toThrow(CsvProblem);
  });
});

describe('formulas', () => {
  it('writes text that would run as a formula behind an apostrophe, and reads it back without', () => {
    expect(guardFormula('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(guardFormula('-5% off')).toBe("'-5% off");
    expect(guardFormula('Rent')).toBe('Rent');

    const bytes = encodeTableCsv(CATEGORIES, [['=cmd|calc', 'expense', null, null, null, false]]);
    expect(bytes.toString('utf8')).toContain("'=cmd|calc");
    expect(decodeCsv(bytes)[1][0]).toBe('=cmd|calc');
  });

  it('leaves numbers alone, negative ones included', () => {
    const row = TRANSACTIONS.columns.map((column) => (column.key === 'amount' ? '-5.00' : null));
    const line = encodeTableCsv(TRANSACTIONS, [row]).toString('utf8').split('\r\n')[1];
    expect(line.split(',')[2]).toBe('-5.00');
  });
});

describe('encodeTableCsv', () => {
  it('writes the header, dates as local times, booleans as words', () => {
    const date = new Date(Date.UTC(2026, 8, 21, 14, 30, 5));
    const row = TRANSACTIONS.columns.map((column) => {
      switch (column.key) {
        case 'date':
          return date;
        case 'type':
          return 'expense';
        case 'amount':
          return '120.50';
        default:
          return null;
      }
    });
    const [header, line] = decodeCsv(encodeTableCsv(TRANSACTIONS, [row]));
    expect(header).toEqual(TRANSACTIONS.columns.map((column) => column.header));
    expect(line.slice(0, 3)).toEqual(['2026-09-21 14:30:05', 'expense', '120.50']);

    const [, category] = decodeCsv(encodeTableCsv(CATEGORIES, [['Food', 'expense', null, null, null, true]]));
    expect(category).toEqual(['Food', 'expense', '', '', '', 'true']);
  });
});

// Enough of Windows-1251 for the test: ASCII, and the Russian alphabet from А (0xC0) to я (0xFF).
function windows1251(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => {
    const code = char.charCodeAt(0);
    return code < 0x80 ? code : code - 0x0410 + 0xc0;
  }));
}
