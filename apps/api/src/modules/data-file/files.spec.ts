import { exportTables } from './export-tables';
import { DataFileProblem, groupNameFromFiles, readDataFiles, writeDataFile } from './files';
import { NOW, sampleSnapshot } from './testing/sample-group';
import { zipFiles } from './zip';

describe('writeDataFile', () => {
  const tables = exportTables(sampleSnapshot(), { timezone: 'UTC', now: NOW });

  it('names the file after the group and the day where it was written', async () => {
    const workbook = await writeDataFile(tables, { format: 'xlsx', table: 'transactions', groupName: 'Семья: дом/дача', timezone: 'Asia/Tokyo', now: new Date('2026-09-21T20:00:00Z') });
    // Already the 22nd in Tokyo; and no characters a file system refuses.
    expect(workbook.name).toBe('Семья дом дача 2026-09-22.xlsx');
    expect(workbook.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const csv = await writeDataFile(tables, { format: 'csv', table: 'series', groupName: 'Family', timezone: 'UTC', now: NOW });
    expect(csv.name).toBe('Family 2026-09-21 series.csv');
    expect(csv.content.toString('utf8')).toContain('Series,Type,Amount');
  });

  it('packs every table into one .zip for CSV, which reads back as a CSV file each', async () => {
    const zip = await writeDataFile(tables, { format: 'csv', groupName: 'Семья', timezone: 'UTC', now: NOW });
    expect(zip.name).toBe('Семья 2026-09-21.zip');
    expect(zip.contentType).toBe('application/zip');

    const sheets = await readDataFiles([{ name: zip.name, content: zip.content }]);
    expect(sheets.map(({ file, sheet }) => [file, sheet])).toEqual([
      ['Семья 2026-09-21 transactions.csv', undefined],
      ['Семья 2026-09-21 accounts.csv', undefined],
      ['Семья 2026-09-21 categories.csv', undefined],
      ['Семья 2026-09-21 series.csv', undefined],
    ]);
    expect(sheets[1].rows[0].slice(0, 2)).toEqual(['Name', 'Currency']);
  });

  it('reads back what it wrote, whichever the format', async () => {
    const workbook = await writeDataFile(tables, { format: 'xlsx', table: 'transactions', groupName: 'Family', timezone: 'UTC', now: NOW });
    const csv = await writeDataFile(tables, { format: 'csv', table: 'accounts', groupName: 'Family', timezone: 'UTC', now: NOW });
    const sheets = await readDataFiles([
      { name: workbook.name, content: workbook.content },
      { name: csv.name, content: csv.content },
    ]);
    expect(sheets.map(({ file, sheet }) => [file, sheet])).toEqual([
      ['Family 2026-09-21.xlsx', 'Transactions'],
      ['Family 2026-09-21.xlsx', 'Accounts'],
      ['Family 2026-09-21.xlsx', 'Categories'],
      ['Family 2026-09-21.xlsx', 'Series'],
      ['Family 2026-09-21 accounts.csv', undefined],
    ]);
  });
});

describe('readDataFiles', () => {
  const text = (value: string) => Buffer.from(value, 'utf8');

  it('reads the CSV files of a .zip, and leaves out what an archiver adds', async () => {
    const zip = zipFiles({
      '__MACOSX/Family/._accounts.csv': text('junk'),
      'Family/.hidden.csv': text('junk'),
      'Family/notes.txt': text('not a table'),
      'Family/ACCOUNTS.CSV': text('Name,Currency\r\nCash,UAH\r\n'),
    });
    const sheets = await readDataFiles([{ name: 'Family.zip', content: zip }]);
    expect(sheets).toEqual([{ file: 'Family/ACCOUNTS.CSV', rows: [['Name', 'Currency'], ['Cash', 'UAH']] }]);
  });

  it('says which file it can’t read, and why', async () => {
    await expect(readDataFiles([{ name: 'old.xls', content: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }])).rejects.toThrow(
      new DataFileProblem('old.xls: Only .xlsx workbooks, .zip files of CSV files, and CSV files are read: save it as one of those'),
    );
    await expect(readDataFiles([{ name: 'broken.xlsx', content: Buffer.from('not a zip') }])).rejects.toThrow(/broken\.xlsx: It isn’t an \.xlsx workbook/);
    // A zip, but not a workbook.
    await expect(readDataFiles([{ name: 'fake.xlsx', content: zipFiles({ 'a.csv': text('x') }) }])).rejects.toThrow(
      /fake\.xlsx: It isn’t an \.xlsx workbook/,
    );
    await expect(readDataFiles([{ name: 'notes.zip', content: zipFiles({ 'notes.txt': text('x') }) }])).rejects.toThrow(
      new DataFileProblem('notes.zip: There are no CSV files in it'),
    );
    await expect(readDataFiles([{ name: 'cut.zip', content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) }])).rejects.toThrow(
      new DataFileProblem('cut.zip: It isn’t a .zip file, or it’s damaged'),
    );
    await expect(readDataFiles([{ name: 'quote.zip', content: zipFiles({ 'a.csv': text('Name\n"never closed\n') }) }])).rejects.toThrow(
      /^quote\.zip: a\.csv: A quote in the file is never closed/,
    );
  });
});

describe('groupNameFromFiles', () => {
  it('is the file’s name, without the table a CSV file of an export holds', () => {
    expect(groupNameFromFiles(['Family 2026-09-21.xlsx'])).toBe('Family 2026-09-21');
    expect(groupNameFromFiles(['Family 2026-09-21 transactions.csv', 'Family 2026-09-21 accounts.csv'])).toBe('Family 2026-09-21');
    expect(groupNameFromFiles(['transactions.csv'])).toBe('transactions');
    expect(groupNameFromFiles([''])).toBe('Import');
  });
});
