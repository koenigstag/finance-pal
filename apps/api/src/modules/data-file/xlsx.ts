import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile, { type Cell as XlsxCell, type SheetData } from 'write-excel-file/node';
import type { Cell, ColumnSpec, TableSpec } from './tables';

export class XlsxProblem extends Error {}

export interface SheetToWrite {
  spec: TableSpec;
  // In the order of spec.columns; see Cell for what each column type holds.
  rows: readonly (readonly Cell[])[];
}

export interface SheetRead {
  name: string;
  rows: Cell[][];
}

// Shown in a spreadsheet, stored the same either way: an amount with its grouping and two decimals,
// a date and time to the minute (the seconds are kept, just not shown).
const MONEY_FORMAT = '#,##0.00';
const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm';
// Text, so a spreadsheet leaves a name like "1-2" alone when it's edited, rather than making it a date.
const TEXT_FORMAT = '@';

/** The sheets as an .xlsx workbook, a header row on top of each, kept in view while scrolling. */
export async function encodeXlsx(sheets: readonly SheetToWrite[]): Promise<Buffer> {
  const workbook = sheets.map(({ spec, rows }) => {
    const header: XlsxCell[] = spec.columns.map((column) => ({ value: column.header, fontWeight: 'bold' }));
    const data: SheetData = [header, ...rows.map((row) => spec.columns.map((column, index) => xlsxCell(column, row[index] ?? null)))];
    return {
      data,
      sheet: spec.title,
      columns: spec.columns.map((column) => ({ width: column.width })),
      stickyRowsCount: 1,
    };
  });
  return writeXlsxFile(workbook).toBuffer();
}

function xlsxCell(column: ColumnSpec, value: Cell): XlsxCell {
  if (value === null) {
    return null;
  }
  switch (column.type) {
    case 'money':
    case 'balance':
      return { value: Number(value), type: Number, format: MONEY_FORMAT };
    case 'percentage':
    case 'integer':
      return { value: Number(value), type: Number };
    case 'boolean':
      return { value: value === true, type: Boolean };
    case 'datetime':
      return { value: value as Date, type: Date, format: DATETIME_FORMAT };
    case 'text':
      return { value: String(value), type: String, format: TEXT_FORMAT };
  }
}

/**
 * Every sheet of an .xlsx workbook, numbers as the text they're stored as (see NumberCell). A
 * workbook is a zip: check it with zipEntryNames first, which is how it's told from a .zip of CSV
 * files anyway.
 */
export async function decodeXlsx(bytes: Uint8Array): Promise<SheetRead[]> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try {
    const sheets = await readXlsxFile(buffer, { parseNumber: (number: string) => ({ number }) });
    // The library's own types say `typeof Date` where it hands over Date objects.
    return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data as unknown as Cell[][] }));
  } catch {
    throw new XlsxProblem('It isn’t an .xlsx workbook, or it’s damaged');
  }
}
