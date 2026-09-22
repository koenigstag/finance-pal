import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Controller,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { isValidTimezone } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { DataFileProblem, groupNameFromFiles, readDataFiles } from '../data-file/files';
import { ImportProblems, collectTables, planImport } from '../data-file/import-plan';
import { TABLES } from '../data-file/tables';
import { ImportService, type ImportSummary } from './import.service';
import { OneMoneyFormatError, parseOneMoneyBackup } from './one-money-parser';

// A backup holds every daily snapshot the app ever wrote, so the file grows with use; 64 MB is
// far above the real ones seen (7 MB) and still bounded. The same bound serves a Finance Pal file.
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_GROUP_NAME = 120;

// What the file interceptors hand over, without depending on multer's own types: the fields used here.
interface UploadedBackup {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Importing into a new group, named after the file, which the caller owns. Authentication is the
 * app's usual bearer token — every route requires one unless marked public — and everything is
 * written as the caller. The web app's Data sheet calls these; with the file in hand, so can curl:
 *
 *   curl -X POST "https://<api>/api/import/1money?timezone=Europe/Kyiv" \
 *        -H "Authorization: Bearer <access token>" \
 *        -F file=@1Money_BACKUP_17_09_2026
 *
 *   curl -X POST "https://<api>/api/import/finance-pal?timezone=Europe/Kyiv" \
 *        -H "Authorization: Bearer <access token>" \
 *        -F file=@"Family 2026-09-21.xlsx"
 */
// The '/api' prefix is part of every route here: ts-rest contracts carry it in their paths,
// so this controller spells it out rather than relying on a global prefix, which the app has none of.
@Controller('api/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post('1money')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async importOneMoney(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_BYTES })] }))
    file: UploadedBackup,
    @CurrentUser() user?: RequestUser,
    // Optional "<1Money currency id>:<ISO code>" pairs, for a file using a currency this importer
    // doesn't know yet. The error says which ids are missing.
    @Query('currencies') currencies?: string,
    // The IANA zone 1Money ran in, which its repeating entries keep to; the app sends the device's.
    @Query('timezone') timezone?: string,
  ): Promise<ImportSummary> {
    const userId = requireUser(user).id;
    const overrides = parseCurrencyOverrides(currencies);
    assertTimezone(timezone);
    const name = groupNameFor(uploadedName(file.originalname));

    // node:sqlite opens a path, not a buffer, and the file arrives in memory: park it in a
    // private temp directory for the length of the request.
    const directory = await mkdtemp(join(tmpdir(), 'ft-import-'));
    const path = join(directory, `${randomUUID()}.sqlite`);
    try {
      await writeFile(path, file.buffer);
      const backup = parseOneMoneyBackup(path, overrides);
      return await this.imports.importBackup(userId, name, backup, timezone);
    } catch (error) {
      if (error instanceof OneMoneyFormatError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /**
   * A Finance Pal file, as the export writes it or as someone filled it in: an .xlsx workbook with
   * the tables as sheets, a .zip of CSV files of one table each, or such CSV files sent together
   * (the field names don't matter). Everything wrong with it comes back at once, a line each, and
   * nothing is written.
   */
  @Post('finance-pal')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_FILE_BYTES, files: TABLES.length } }))
  async importFinancePal(
    @UploadedFiles() files: UploadedBackup[] | undefined,
    @CurrentUser() user?: RequestUser,
    // The IANA zone the file's dates are local times in; the app sends the device's.
    @Query('timezone') timezone?: string,
  ): Promise<ImportSummary> {
    const userId = requireUser(user).id;
    if (!files || files.length === 0) {
      throw new BadRequestException('Send the workbook, the .zip, or the CSV files, as multipart form data');
    }
    assertTimezone(timezone);
    const zone = timezone ?? 'UTC';
    const now = new Date();

    const uploads = files.map((file) => ({ name: uploadedName(file.originalname), content: file.buffer }));
    const name = cleanGroupName(groupNameFromFiles(uploads.map((upload) => upload.name)));
    try {
      const tables = collectTables(await readDataFiles(uploads));
      const plan = planImport(tables, { timezone: zone, now, currencies: await this.imports.currencyCodes() });
      return await this.imports.importFinancePal(userId, name, plan, { timezone: zone, now });
    } catch (error) {
      if (error instanceof DataFileProblem) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof ImportProblems) {
        throw new BadRequestException(error.problems);
      }
      throw error;
    }
  }
}

function assertTimezone(timezone: string | undefined): void {
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    throw new BadRequestException(`Unknown time zone "${timezone}"`);
  }
}

// The uploaded file's own name, which is what the person recognizes it by. Multer decodes it as
// latin1 per the HTTP spec, so non-ASCII names need putting back together.
function uploadedName(originalName: string): string {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  return isMojibake(decoded) ? originalName : decoded;
}

// A group's name from a file's: without its extension.
function groupNameFor(fileName: string): string {
  return cleanGroupName(fileName.replace(/\.[A-Za-z0-9]{1,8}$/, ''));
}

function cleanGroupName(name: string): string {
  return name.replace(/[\\/]/g, ' ').trim().slice(0, MAX_GROUP_NAME) || 'Import';
}

// A name that was plain ASCII to begin with survives the round trip unchanged; anything with a
// replacement character came out of it worse than it went in.
function isMojibake(decoded: string): boolean {
  return decoded.includes('�');
}

function parseCurrencyOverrides(raw?: string): Record<number, string> {
  if (!raw) {
    return {};
  }
  const overrides: Record<number, string> = {};
  for (const pair of raw.split(',')) {
    const [id, code] = pair.split(':');
    const currencyId = Number(id);
    if (!Number.isInteger(currencyId) || !/^[A-Za-z]{3}$/.test(code ?? '')) {
      throw new BadRequestException(`Expected currencies as "<id>:<code>,…", got "${pair}"`);
    }
    overrides[currencyId] = code.toUpperCase();
  }
  return overrides;
}
