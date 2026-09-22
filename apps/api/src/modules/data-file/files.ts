import { CsvProblem, decodeCsv, encodeTableCsv } from './csv';
import type { ExportedTable } from './export-tables';
import type { SourceSheet } from './import-plan';
import { TABLES, normalizeHeader, type TableName } from './tables';
import { formatDateTime, wallClock } from './values';
import { XlsxProblem, decodeXlsx, encodeXlsx } from './xlsx';
import { ZipProblem, isZip, unzipEntries, zipEntryNames, zipFiles } from './zip';

export const FILE_FORMATS = ['xlsx', 'csv'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_TYPE = 'text/csv; charset=utf-8';
const ZIP_TYPE = 'application/zip';

export interface DataFile {
  name: string;
  contentType: string;
  content: Buffer;
}

export interface WriteRequest {
  format: FileFormat;
  // CSV only: that one table as a CSV file on its own. Without it, CSV is every table, a CSV file
  // each, together in a .zip — one download that imports back whole, like a workbook.
  table?: TableName;
  groupName: string;
  timezone: string;
  now: Date;
}

/**
 * The file an export hands over: the whole group as a workbook, or as a .zip of CSV files, or one
 * of its tables as CSV. Named after the group and the day ("Family 2026-09-21.xlsx"), which is also
 * what a group imported from it is called; a CSV file ends with its table ("… transactions.csv").
 */
export async function writeDataFile(tables: readonly ExportedTable[], request: WriteRequest): Promise<DataFile> {
  const day = formatDateTime(wallClock(request.now, request.timezone)).slice(0, 10);
  const base = `${fileSafe(request.groupName)} ${day}`;
  const csvName = ({ spec }: ExportedTable) => `${base} ${spec.title.toLowerCase()}.csv`;

  if (request.format === 'xlsx') {
    return { name: `${base}.xlsx`, contentType: XLSX_TYPE, content: await encodeXlsx(tables) };
  }
  if (request.table !== undefined) {
    const table = tables.find(({ spec }) => spec.name === request.table) as ExportedTable;
    return { name: csvName(table), contentType: CSV_TYPE, content: encodeTableCsv(table.spec, table.rows) };
  }
  const files = Object.fromEntries(tables.map((table) => [csvName(table), encodeTableCsv(table.spec, table.rows)]));
  return { name: `${base}.zip`, contentType: ZIP_TYPE, content: zipFiles(files) };
}

// What file systems refuse in a name, and control characters.
function fileSafe(name: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return safe || 'Finance Pal';
}

export interface UploadedDataFile {
  name: string;
  content: Buffer;
}

/** A file that can't be read at all, in words for whoever chose it. */
export class DataFileProblem extends Error {}

// What a zip is when it's a workbook.
const WORKBOOK_ENTRY = 'xl/workbook.xml';

// The CSV files in a .zip, leaving out what an archiver adds of its own: macOS's __MACOSX folder
// and hidden files.
function isCsvEntry(name: string): boolean {
  const base = name.split('/').at(-1) ?? '';
  return /\.csv$/i.test(base) && !base.startsWith('.') && !name.startsWith('__MACOSX/');
}

/**
 * The sheets of the uploaded files: each workbook's sheets, and each CSV file as one of its own,
 * whether it came alone or in a .zip. A zip is a workbook when it holds one's parts; any other is a
 * .zip of CSV files.
 */
export async function readDataFiles(files: readonly UploadedDataFile[]): Promise<SourceSheet[]> {
  const sheets: SourceSheet[] = [];
  for (const { name, content } of files) {
    try {
      if (isZip(content)) {
        const entries = zipEntryNames(content);
        if (entries.includes(WORKBOOK_ENTRY)) {
          for (const sheet of await decodeXlsx(content)) {
            sheets.push({ file: name, sheet: sheet.name, rows: sheet.rows });
          }
        } else if (/\.xlsx$/i.test(name)) {
          throw new DataFileProblem('It isn’t an .xlsx workbook, or it’s damaged');
        } else {
          sheets.push(...csvEntries(name, content, entries));
        }
      } else if (/\.xlsx$/i.test(name)) {
        throw new DataFileProblem('It isn’t an .xlsx workbook, or it’s damaged');
      } else if (/\.(xls|ods|numbers)$/i.test(name)) {
        throw new DataFileProblem('Only .xlsx workbooks, .zip files of CSV files, and CSV files are read: save it as one of those');
      } else {
        sheets.push({ file: name, rows: decodeCsv(content) });
      }
    } catch (error) {
      if (error instanceof DataFileProblem || error instanceof XlsxProblem || error instanceof CsvProblem || error instanceof ZipProblem) {
        throw new DataFileProblem(`${name}: ${error.message}`);
      }
      throw error;
    }
  }
  return sheets;
}

// A .zip's CSV files, each a sheet named by its path in the archive, in the order it lists them.
function csvEntries(zipName: string, content: Buffer, entries: string[]): SourceSheet[] {
  const wanted = entries.filter(isCsvEntry);
  if (wanted.length === 0) {
    throw new DataFileProblem('There are no CSV files in it');
  }
  const unpacked = unzipEntries(content, isCsvEntry);
  return wanted.map((entry) => {
    try {
      return { file: entry, rows: decodeCsv(unpacked[entry]) };
    } catch (error) {
      if (error instanceof CsvProblem) {
        throw new DataFileProblem(`${entry}: ${error.message}`);
      }
      throw error;
    }
  });
}

/**
 * What to call a group imported from these files: the first one's name, without its extension, or
 * the word naming the table a CSV file of an export ends with.
 */
export function groupNameFromFiles(names: readonly string[]): string {
  const [first = ''] = names;
  let name = first.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim();
  const words = name.split(/\s+/);
  const last = normalizeHeader(words.at(-1) ?? '');
  if (words.length > 1 && TABLES.some((spec) => normalizeHeader(spec.title) === last)) {
    name = words.slice(0, -1).join(' ');
  }
  return name || 'Import';
}
