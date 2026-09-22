import { FileArchiveIcon, FileSpreadsheetIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useGroups } from '@/features/groups/queries';
import { ApiError } from '@/lib/api/client';
import { useExportGroup, type ExportFormat } from './queries';

/**
 * Taking a group out as a spreadsheet, whole either way: one workbook with a sheet per table, or
 * the same tables as CSV files in one .zip. The group the app is on unless another is picked.
 */
export function DataExport({ currentGroupId }: { currentGroupId?: string }) {
  const { t } = useTranslation();
  const groups = useGroups();
  const exportGroup = useExportGroup();
  const [picked, setPicked] = useState<string | undefined>(currentGroupId);

  if (groups.isPending) {
    return <Spinner className="mx-auto mt-6" />;
  }
  const list = groups.data ?? [];
  const group = list.find(({ id }) => id === picked) ?? list.find(({ id }) => id === currentGroupId) ?? list[0];
  if (!group) {
    return <p className="text-sm text-muted-foreground">{t('data.export.noGroups')}</p>;
  }

  const error = exportGroup.error;
  const message = error instanceof ApiError && error.status < 500 && error.message ? error.message : exportGroup.isError ? t('errors.generic') : null;
  // The format being fetched, for the spinner on the button that asked for it.
  const pending = exportGroup.isPending ? exportGroup.variables?.format : undefined;

  const formats: { format: ExportFormat; icon: LucideIcon; title: string; description: string; download: string }[] = [
    {
      format: 'xlsx',
      icon: FileSpreadsheetIcon,
      title: t('data.export.workbook.title'),
      description: t('data.export.workbook.description'),
      download: t('data.export.workbook.download'),
    },
    {
      format: 'csv',
      icon: FileArchiveIcon,
      title: t('data.export.csv.title'),
      description: t('data.export.csv.description'),
      download: t('data.export.csv.download'),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      {list.length > 1 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="export-group">{t('data.export.group')}</Label>
          <Select value={group.id} onValueChange={setPicked}>
            <SelectTrigger id="export-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map(({ id, name }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {formats.map(({ format, icon: Icon, title, description, download }) => (
        <section key={format} className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
              <Icon />
            </span>
            <div className="min-w-0">
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <Button
            variant={format === 'xlsx' ? 'default' : 'outline'}
            disabled={exportGroup.isPending}
            onClick={() => exportGroup.mutate({ groupId: group.id, format })}
          >
            {pending === format ? <Spinner /> : <Icon />}
            {download}
          </Button>
        </section>
      ))}

      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
