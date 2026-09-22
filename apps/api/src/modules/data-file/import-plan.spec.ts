import { decodeCsv, encodeTableCsv } from './csv';
import { exportTables, type GroupSnapshot } from './export-tables';
import { readDataFiles, writeDataFile } from './files';
import { ImportProblems, collectTables, planImport, type ImportPlan, type PlanOptions, type SourceSheet } from './import-plan';
import { NOW, sampleSnapshot } from './testing/sample-group';
import { decodeXlsx, encodeXlsx } from './xlsx';

const OPTIONS: PlanOptions = { timezone: 'UTC', now: NOW, currencies: new Set(['UAH', 'USD', 'EUR']) };

function asCsvFiles(snapshot: GroupSnapshot): SourceSheet[] {
  return exportTables(snapshot, { timezone: 'UTC', now: NOW }).map(({ spec, rows }) => ({
    file: `Family 2026-09-21 ${spec.title.toLowerCase()}.csv`,
    rows: decodeCsv(encodeTableCsv(spec, rows)),
  }));
}

async function asWorkbook(snapshot: GroupSnapshot): Promise<SourceSheet[]> {
  const sheets = await decodeXlsx(await encodeXlsx(exportTables(snapshot, { timezone: 'UTC', now: NOW })));
  return sheets.map(({ name, rows }) => ({ file: 'Family 2026-09-21.xlsx', sheet: name, rows }));
}

// The export's own .zip, written and read as the API does.
async function asZip(snapshot: GroupSnapshot): Promise<SourceSheet[]> {
  const tables = exportTables(snapshot, { timezone: 'UTC', now: NOW });
  const zip = await writeDataFile(tables, { format: 'csv', groupName: 'Family', timezone: 'UTC', now: NOW });
  return readDataFiles([{ name: zip.name, content: zip.content }]);
}

// A CSV file as someone would type it: lines of comma-separated text.
function csv(file: string, ...lines: string[]): SourceSheet {
  return { file, rows: decodeCsv(Buffer.from(lines.join('\n'))) };
}

function plan(sources: SourceSheet[], options: Partial<PlanOptions> = {}): ImportPlan {
  return planImport(collectTables(sources), { ...OPTIONS, ...options });
}

function problemsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ImportProblems) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected the file to be refused');
}

describe.each([
  ['a workbook', asWorkbook],
  ['a .zip of CSV files', asZip],
  ['CSV files', async (snapshot: GroupSnapshot) => asCsvFiles(snapshot)],
])('an export read back from %s', (_format, write) => {
  let imported: ImportPlan;
  beforeAll(async () => {
    imported = plan(await write(sampleSnapshot()));
  });

  it('brings back every account, told apart by name and currency', () => {
    expect(imported.accounts.map(({ name, currency, type, isFavourite, archived }) => ({ name, currency, type, isFavourite, archived }))).toEqual([
      { name: 'Cash', currency: 'UAH', type: 'regular', isFavourite: true, archived: false },
      { name: 'Card', currency: 'UAH', type: 'regular', isFavourite: false, archived: false },
      { name: 'Card', currency: 'USD', type: 'savings', isFavourite: false, archived: false },
      { name: 'cash (2)', currency: 'UAH', type: 'regular', isFavourite: false, archived: true },
    ]);
    expect(imported.accounts[0].icon).toBe('wallet');
    expect(imported.accounts[1].color).toBe('#3b82f6');
    expect(imported.accounts[2].goalAmount).toBe('5000.00');
    // Their transactions make the balances up again; nothing to open with.
    expect(imported.accounts.every((account) => account.openingBalance === null)).toBe(true);
  });

  it('brings back the categories, each before its subcategories', () => {
    expect(imported.categories.map(({ name, type, parentKey, archived }) => ({ name, type, parentKey, archived }))).toEqual([
      { name: 'Food', type: 'expense', parentKey: null, archived: false },
      { name: 'Rent', type: 'expense', parentKey: null, archived: false },
      { name: 'Salary', type: 'income', parentKey: null, archived: true },
      { name: 'Groceries', type: 'expense', parentKey: 'expense|food', archived: false },
    ]);
  });

  it('brings back the transactions as they were', () => {
    const [salary, groceries, transfer, rent, planned, moved] = imported.transactions;
    expect(salary).toMatchObject({ type: 'income', amount: '3000.00', accountKey: 'UAH|cash', categoryKey: 'income|salary' });
    expect(salary.date.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(groceries).toMatchObject({
      amount: '120.50',
      categoryKey: 'expense|food',
      subcategoryKey: 'expense|food|groceries',
      note: '=milk, "bread"',
      tags: ['home', 'weekly'],
    });
    expect(groceries.date.toISOString()).toBe('2026-09-02T18:30:15.000Z');
    expect(transfer).toMatchObject({ accountKey: 'UAH|card', toAccountKey: 'USD|card', amount: '4100.00', destAmount: '100.00' });
    // Still an estimate when it was written: converted afresh at the rate.
    expect(planned.destAmount).toBeNull();
    expect(moved).toMatchObject({ accountKey: 'UAH|cash (2)', toAccountKey: 'UAH|cash' });
    expect(imported.tags).toEqual(['home', 'weekly']);

    // The series' planned transaction goes on as the series' own, untouched.
    expect(rent.occurrence).toEqual({ series: 1, recurrenceDate: new Date('2026-09-30T15:00:00Z'), customized: false });
    expect([salary, groceries, transfer, planned, moved].every((transaction) => transaction.occurrence === null)).toBe(true);
  });

  it('carries the series on from the date after the one it has planned', () => {
    expect(imported.series).toHaveLength(1);
    expect(imported.series[0]).toMatchObject({
      number: 1,
      type: 'expense',
      amount: '500.00',
      accountKey: 'UAH|card',
      categoryKey: 'expense|rent',
      intervalUnit: 'month',
      intervalValue: 1,
      timezone: 'Asia/Tokyo',
      active: true,
      crossCurrency: false,
    });
    expect(imported.series[0].startsAt.toISOString()).toBe('2026-01-31T15:00:00.000Z');
    // Midnight on the 1st of November in Tokyo.
    expect(imported.series[0].nextRunDate.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });
});

describe('a series read back', () => {
  it('catches up on the dates it missed, from a file written a while ago', async () => {
    const imported = plan(await asWorkbook(sampleSnapshot()), { now: new Date('2026-10-15T00:00:00Z') });
    const rent = imported.transactions[3];
    // Its planned transaction has happened by now, and stands alone as what happened.
    expect(rent.occurrence).toBeNull();
    expect(imported.series[0].nextRunDate.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('knows a planned transaction someone moved, or changed', () => {
    const snapshot = sampleSnapshot();
    snapshot.transactions[3].date = new Date('2026-10-02T09:00:00Z');
    let imported = plan(asCsvFiles(snapshot));
    expect(imported.transactions[3].occurrence).toEqual({ series: 1, recurrenceDate: new Date('2026-09-30T15:00:00Z'), customized: true });

    const changed = sampleSnapshot();
    changed.transactions[3].amount = '550.00';
    imported = plan(asCsvFiles(changed));
    expect(imported.transactions[3].occurrence?.customized).toBe(true);
  });

  it('starts one typed in from its Next date, or else its Start', () => {
    const imported = plan([
      csv(
        'series.csv',
        'Type,Amount,Currency,Account,Category,Repeat,Every,Start,Next date',
        'expense,500,UAH,Card,Rent,month,1,2026-01-05,2026-10-05',
        'income,100,UAH,Card,Interest,week,2,2026-09-01 08:00,',
      ),
    ]);
    const [rent, interest] = imported.series;
    expect(rent.number).toBe(1);
    expect(rent.nextRunDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    // From its start, in the past: every date until today is recorded, as the app does.
    expect(interest.number).toBe(2);
    expect(interest.nextRunDate.toISOString()).toBe('2026-09-01T08:00:00.000Z');
    expect(interest.intervalValue).toBe(2);
    expect(imported.categories.map((category) => `${category.type} ${category.name}`)).toEqual(['expense Rent', 'income Interest']);
  });

  it('plans one transaction at a time, of its own kind', () => {
    const problems = problemsOf(() =>
      plan([
        csv('series.csv', 'Series,Type,Amount,Currency,Account,Repeat,Start', '1,expense,500,UAH,Card,month,2026-01-05'),
        csv(
          'transactions.csv',
          'Date,Type,Amount,Currency,Account,Series',
          '2026-10-05,expense,500,UAH,Card,1',
          '2026-11-05,expense,500,UAH,Card,1',
          '2026-10-06,income,5,UAH,Card,1',
          '2026-10-07,income,5,UAH,Card,7',
        ),
      ]),
    );
    expect(problems).toEqual([
      "Transactions, row 5: There's no series 7 in the Series table",
      'Transactions, row 4: series 1 repeats a expense, and this is a income',
      'Transactions, rows 2, 3: all marked as series 1, which plans one transaction at a time',
    ]);
  });
});

describe('a table typed in by hand', () => {
  it('opens the accounts and categories that transactions name, in the order they come up', () => {
    const imported = plan([
      csv(
        'bank.csv',
        'date,type,amount,currency,account,category,subcategory,to account,currency received,note',
        '2026-09-01,income,"25 000,00",UAH,Monobank,Salary,,,,',
        '2026-09-02 13:05,Expense,120.5,UAH,Monobank,Food,Cafe,,,coffee',
        // The to account's currency comes up only on the row after.
        '2026-09-03,transfer,40,UAH,Monobank,,,Wise,USD,',
        '2026-09-04,expense,3,,Wise,Food,,,,',
        '2026-09-05,expense,20,UAH,Monobank,Cafe,,,,',
      ),
    ]);
    expect(imported.accounts.map((account) => `${account.name} ${account.currency}`)).toEqual(['Monobank UAH', 'Wise USD']);
    expect(imported.categories.map((category) => category.key)).toEqual(['income|salary', 'expense|food', 'expense|cafe', 'expense|food|cafe']);
    expect(imported.transactions[0].amount).toBe('25000.00');
    expect(imported.transactions[1].date.toISOString()).toBe('2026-09-02T13:05:00.000Z');
    // Currencies differ, and nothing says what arrived: converted at the rate.
    expect(imported.transactions[2]).toMatchObject({ toAccountKey: 'USD|wise', destAmount: null });
    // Without a Categories table a name is a new category, even one a subcategory elsewhere has.
    expect(imported.transactions[4].categoryKey).toBe('expense|cafe');
  });

  it('opens a listed account with its balance when no transaction touches it', () => {
    const imported = plan([
      csv('accounts.csv', 'Name;Currency;Balance;Type', 'Cash;UAH;1 500,50;', 'Credit card;UAH;-2000;debt', 'Empty;EUR;0;'),
    ]);
    expect(imported.accounts.map((account) => [account.name, account.type, account.openingBalance])).toEqual([
      ['Cash', 'regular', '1500.50'],
      ['Credit card', 'debt', '-2000'],
      ['Empty', 'regular', null],
    ]);
  });

  it('files under what the Categories table has, and takes a subcategory named as the category', () => {
    const imported = plan([
      csv('categories.csv', 'Name,Type,Parent', 'Cafe,expense,Food', 'Food,expense,', 'Salary,income,'),
      csv('transactions.csv', 'Date,Type,Amount,Currency,Account,Category,Subcategory', '2026-09-02,expense,5,UAH,Cash,Cafe,', '2026-09-03,expense,7,UAH,Cash,,Cafe'),
    ]);
    // Parents first, whatever order the rows came in.
    expect(imported.categories.map((category) => category.key)).toEqual(['expense|food', 'income|salary', 'expense|food|cafe']);
    for (const transaction of imported.transactions) {
      expect(transaction).toMatchObject({ categoryKey: 'expense|food', subcategoryKey: 'expense|food|cafe' });
    }
  });

  it('says what’s wrong with every row, and where', () => {
    const problems = problemsOf(() =>
      plan([
        csv('accounts.csv', 'Name,Currency', 'Cash,UAH', 'Cash,uah', 'Wallet,XYZ', 'Card,'),
        csv('categories.csv', 'Name,Type,Parent', 'Food,expense,', 'Cafe,expense,Drinks', 'Salary,income,'),
        csv(
          'transactions.csv',
          'Date,Type,Amount,Account,Category,To account,Percentage,Base amount,Round balance to',
          '2026-13-01,expense,10,Cash,Food,,,,',
          '2026-09-01,spending,1.234,Cash,Food,,,,',
          '2026-09-01,expense,10,Cahs,Salary,,,,',
          '2026-09-01,transfer,10,Cash,Food,,,,',
          '2026-09-01,expense,-10,Cash,,Cash,,5,3',
          ',,,,,,,,',
          '2026-09-01,income,10,Cash,Salary,,150,,',
        ),
      ]),
    );
    expect(problems).toEqual([
      'Accounts, row 3: row 2 is Cash in UAH too, and accounts are told apart by name and currency',
      'Accounts, row 4: Currency: the app has no currency "XYZ"',
      'Accounts, row 5: Currency is empty',
      'Categories, row 3: There\'s no top-level expense category named "Drinks" for its Parent',
      'Transactions, row 2: Date: "2026-13-01" isn\'t a date that exists',
      'Transactions, row 3: Type: "spending" isn\'t one of expense, income, transfer',
      'Transactions, row 3: Amount: "1.234" isn\'t an amount like 1250.50',
      'Transactions, row 4: There\'s no account named "Cahs" in the Accounts table',
      'Transactions, row 4: "Salary" is an income category, and this is an expense',
      'Transactions, row 5: A transfer needs its To account',
      'Transactions, row 5: A transfer has no category',
      'Transactions, row 6: Amount: -10 is negative: amounts are written without a sign, and the type says which way the money went',
      'Transactions, row 6: Base amount goes with a Percentage',
      'Transactions, row 6: Round balance to is 1, 10, 100 or 1000',
      'Transactions, row 6: Only a transfer has a To account',
      'Transactions, row 8: Percentage: "150" isn\'t a percentage above 0 and at most 100, like 12.5',
    ]);
  });

  it('asks for the currency of an account nothing else names one for', () => {
    const problems = problemsOf(() => plan([csv('transactions.csv', 'Date,Type,Amount,Account', '2026-09-01,expense,10,Cash')]));
    expect(problems).toEqual(['Transactions, row 2: "Cash" needs a currency to be opened in: fill in Currency, or add an Accounts table']);
  });

  it('allows nothing only for an amount from the balance, still to be worked out', () => {
    const imported = plan([
      csv(
        'transactions.csv',
        'Date,Type,Amount,Currency,Account,Percentage,Round balance to',
        '2026-10-01,expense,0,UAH,Card,5,',
        '2026-10-01,expense,0,UAH,Card,,10',
      ),
    ]);
    expect(imported.transactions.map((transaction) => transaction.amount)).toEqual(['0', '0']);
    const problems = problemsOf(() => plan([csv('transactions.csv', 'Date,Type,Amount,Currency,Account,Percentage', '2026-09-01,expense,0,UAH,Card,5')]));
    expect(problems).toEqual(['Transactions, row 2: Amount must be greater than zero']);
  });
});

describe('collectTables', () => {
  it('recognizes a sheet by its name, a CSV file by its header, and leaves other sheets alone', () => {
    const tables = collectTables([
      { file: 'book.xlsx', sheet: 'Notes', rows: [['Anything'], ['at all']] },
      { file: 'book.xlsx', sheet: 'Categories', rows: [[], ['Name', 'Type'], ['Food', 'expense']] },
      { file: 'people.csv', rows: [['Name', 'Currency', 'Type'], ['Cash', 'UAH', 'regular']] },
    ]);
    expect(tables.map(({ spec, source, rows }) => [spec.name, source, rows.map((row) => row.number)])).toEqual([
      // The header is the first row with anything in it; row numbers are the sheet's own.
      ['categories', 'book.xlsx, sheet Categories', [3]],
      ['accounts', 'people.csv', [2]],
    ]);
  });

  it('refuses a CSV file it can’t tell, a table without its columns, and two of one table', () => {
    const problems = problemsOf(() =>
      collectTables([
        { file: 'a.csv', rows: [['Name', 'Currency'], ['Cash', 'UAH']] },
        { file: 'b.csv', rows: [['Name', 'Currency'], ['Card', 'UAH']] },
        { file: 'c.csv', rows: [['Foo', 'Bar']] },
        { file: 'd.xlsx', sheet: 'Transactions', rows: [['Date', 'Amount']] },
        { file: 'e.csv', rows: [] },
      ]),
    );
    expect(problems).toEqual([
      'b.csv holds accounts, and so does a.csv: one table of each, please',
      "c.csv: its first row doesn't name the columns of transactions, accounts, categories or series",
      'd.xlsx, sheet Transactions: Transactions need a column for each of: Type, Account',
      'e.csv is empty',
    ]);
  });
});
