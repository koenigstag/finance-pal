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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { isValidTimezone } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { ImportService, type ImportSummary } from './import.service';
import { OneMoneyFormatError, parseOneMoneyBackup } from './one-money-parser';

// A backup holds every daily snapshot the app ever wrote, so the file grows with use; 64 MB is
// far above the real ones seen (7 MB) and still bounded.
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_GROUP_NAME = 120;

// What FileInterceptor hands over, without depending on multer's own types: the fields used here.
interface UploadedBackup {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Importing from other finance apps. No UI yet: this is meant to be called with the file in hand,
 * e.g.
 *
 *   curl -X POST "https://<api>/api/import/1money?timezone=Europe/Kyiv" \
 *        -H "Authorization: Bearer <access token>" \
 *        -F file=@1Money_BACKUP_17_09_2026
 *
 * The new group is named after the file. Authentication is the app's usual bearer token — every
 * route requires one unless marked public — and the import is written as the caller, who owns the
 * resulting group.
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
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new BadRequestException(`Unknown time zone "${timezone}"`);
    }
    const name = groupNameFor(file.originalname);

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
}

// The uploaded file's own name, which is what the person recognizes the export by. Multer decodes
// it as latin1 per the HTTP spec, so non-ASCII names need putting back together.
function groupNameFor(originalName: string): string {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  const name = (isMojibake(decoded) ? originalName : decoded)
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[\\/]/g, ' ')
    .trim();
  return name.slice(0, MAX_GROUP_NAME) || 'Import';
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
