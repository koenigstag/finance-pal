import type { Cell, ColumnSpec, TableSpec } from './tables';
import { formatDateTime } from './values';

/**
 * CSV as spreadsheets write and read it (RFC 4180): fields split by a delimiter, quoted when they
 * hold one, a quote or a line break, a doubled quote standing for a quote inside a quoted field.
 */

// Excel reads a CSV file as the system's legacy code page unless it starts with this mark, which
// turns every Cyrillic letter into gibberish.
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export class CsvProblem extends Error {}

/** A table as a CSV file: its header row, then a row per record. */
export function encodeTableCsv(spec: TableSpec, rows: readonly (readonly Cell[])[]): Buffer {
  return encodeCsv([
    spec.columns.map((column) => column.header),
    ...rows.map((row) => spec.columns.map((column, index) => csvField(column, row[index] ?? null))),
  ]);
}

// Numbers as their decimal text, dates as local times, so that the file reads back as written.
function csvField(column: ColumnSpec, cell: Cell): string {
  if (cell === null) {
    return '';
  }
  switch (column.type) {
    case 'datetime':
      return formatDateTime(cell as Date);
    case 'boolean':
      return cell === true ? 'true' : 'false';
    case 'text':
      return guardFormula(String(cell));
    default:
      return String(cell);
  }
}

/** Rows as a UTF-8 CSV file, comma-separated, with the byte order mark spreadsheets look for. */
export function encodeCsv(rows: readonly (readonly string[])[]): Buffer {
  const text = rows.map((row) => row.map(quoteField).join(',')).join('\r\n');
  return Buffer.concat([UTF8_BOM, Buffer.from(`${text}\r\n`, 'utf8')]);
}

function quoteField(field: string): string {
  return /[",\r\n]|^\s|\s$/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

// A spreadsheet opening a CSV file runs a cell starting with one of these as a formula, and a
// formula can fetch things or start programs. Someone else in the group may have written the note
// a member exports, so text that starts this way is written behind an apostrophe — which
// spreadsheets show as text and hide — and reading takes it off again.
const FORMULA_START = /^[=+\-@\t\r]/;

export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function unguardFormula(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}

/**
 * A CSV file's rows. Written by this app or by a spreadsheet: comma-, semicolon- or tab-separated
 * (a spreadsheet set to a language with a decimal comma separates by semicolons), in UTF-8 with or
 * without its mark, UTF-16 as "Unicode text" is saved, or failing those Windows-1251, which is what
 * Excel saves a CSV file in on a Russian or Ukrainian system.
 */
export function decodeCsv(bytes: Uint8Array): string[][] {
  let text = decodeText(bytes);
  // Excel's own way of naming the delimiter, on a line of its own before the header.
  const declared = /^sep=(.)\r?\n/i.exec(text);
  if (declared) {
    text = text.slice(declared[0].length);
  }
  const delimiter = declared?.[1] ?? sniffDelimiter(text);
  return parseCsv(text, delimiter).map((row) => row.map(unguardFormula));
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8. Cyrillic text in Windows-1251 practically never passes for it, and this app's
    // users write in Russian and Ukrainian; a file in another legacy code page reads wrong either way.
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

// The delimiter the header line uses most, outside quotes.
function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best = ',';
  for (const [delimiter, count] of counts) {
    if (count > (counts.get(best) ?? 0)) {
      best = delimiter;
    }
  }
  return best;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Whether the current field started with a quote: a quote anywhere else is just a character,
  // as in a field like 24" monitor.
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (char === '\r' || char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) {
    throw new CsvProblem('A quote in the file is never closed, so its rows can’t be told apart');
  }
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
