import { unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * Zip archives, which the data files come in twice over: an .xlsx workbook is one, and a CSV export
 * is one holding a CSV file per table.
 */
export class ZipProblem extends Error {}

// Every zip starts with these bytes.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// A small zip can unpack to gigabytes. Well above what a real export unpacks to (tens of megabytes
// for years of transactions), and checked before anything is inflated.
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * The names of a zip's entries, once what they'd unpack to has been checked: the sizes the archive
 * declares, read without inflating anything.
 */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let unpacked = 0;
  try {
    unzipSync(bytes, {
      filter: (entry) => {
        names.push(entry.name);
        unpacked += entry.originalSize;
        return false;
      },
    });
  } catch {
    throw new ZipProblem('It isn’t a .zip file, or it’s damaged');
  }
  if (unpacked > MAX_UNPACKED_BYTES) {
    throw new ZipProblem('It unpacks to more than an export of this app’s data ever could');
  }
  return names;
}

/** The entries `wanted` picks, unpacked. Check the archive with zipEntryNames first. */
export function unzipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, { filter: (entry) => wanted(entry.name) });
  } catch {
    throw new ZipProblem('It isn’t a .zip file, or it’s damaged');
  }
}

/** Files as a zip, their names in UTF-8 and flagged so, which unzipping tools go by. */
export function zipFiles(files: Record<string, Uint8Array>): Buffer {
  const zippable: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    zippable[name] = [content, { level: 6 }];
  }
  return Buffer.from(zipSync(zippable));
}
