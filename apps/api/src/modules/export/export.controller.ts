import { BadRequestException, Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { isValidTimezone } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { FILE_FORMATS, type FileFormat } from '../data-file/files';
import { TABLE_NAMES, type TableName } from '../data-file/tables';
import { ExportService } from './export.service';

/**
 * A group's data as a file, for backing it up, looking at it in a spreadsheet, or importing it into
 * another group (POST /api/import/finance-pal). A binary download rather than JSON, so it isn't a
 * ts-rest route:
 *
 *   curl -OJ "https://<api>/api/groups/<group id>/export?format=xlsx&timezone=Europe/Kyiv" \
 *        -H "Authorization: Bearer <access token>"
 *
 * format: xlsx (default) is every table as a sheet of one workbook; csv is every table as a CSV
 * file, together in a .zip. Both import back whole.
 * table: with csv, just that table — transactions, accounts, categories or series — as a CSV file
 * on its own, for a script that wants one.
 * timezone: the IANA zone the file's dates are written as local times in; UTC by default.
 */
// The '/api' prefix is spelled out for the reason given on ImportController.
@Controller('api/groups/:groupId/export')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  // A money history has no business in a shared cache.
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @CurrentUser() user?: RequestUser,
    @Query('format') format = 'xlsx',
    @Query('table') table?: string,
    @Query('timezone') timezone = 'UTC',
  ): Promise<StreamableFile> {
    const userId = requireUser(user).id;
    if (!(FILE_FORMATS as readonly string[]).includes(format)) {
      throw new BadRequestException(`format is one of ${FILE_FORMATS.join(', ')}`);
    }
    if (table !== undefined && (format !== 'csv' || !(TABLE_NAMES as readonly string[]).includes(table))) {
      throw new BadRequestException(`table goes with format=csv, and is one of ${TABLE_NAMES.join(', ')}`);
    }
    if (!isValidTimezone(timezone)) {
      throw new BadRequestException(`Unknown time zone "${timezone}"`);
    }

    const file = await this.exports.exportGroup(userId, groupId, {
      format: format as FileFormat,
      table: table as TableName | undefined,
      timezone,
    });
    return new StreamableFile(file.content, {
      type: file.contentType,
      disposition: attachment(file.name),
      length: file.content.length,
    });
  }
}

/**
 * Content-Disposition for a file name that may not be ASCII (a group called "Семья"): the name
 * itself for clients that read RFC 5987, and an ASCII stand-in for those that don't.
 */
function attachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
