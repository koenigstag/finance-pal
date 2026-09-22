import { ExternalLinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { REPOSITORY_URL } from '@/lib/build-info';
import { ImportFlow } from './import-flow';
import { useImportFinancePal } from './queries';

// Every column of every table, for a file filled in by hand.
export const DATA_FILES_DOCS_URL = `${REPOSITORY_URL}/blob/main/docs/data-files.md`;

// Extensions for pickers that go by name, types for those that go by type (Android's). Windows
// calls a zip application/x-zip-compressed.
const ACCEPT = [
  '.xlsx',
  '.zip',
  '.csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'text/csv',
].join(',');

/** Picking a Finance Pal workbook, .zip or CSV files of its tables, and what came of it. */
export function FinancePalImport({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const importer = useImportFinancePal();
  return (
    <ImportFlow
      steps={[t('data.import.financePal.step1'), t('data.import.financePal.step2'), t('data.import.financePal.step3')]}
      fileLabel={t('data.import.financePal.files')}
      accept={ACCEPT}
      multiple
      importer={importer}
      hint={
        <a
          href={DATA_FILES_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-4"
        >
          {t('data.import.financePal.columns')}
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </a>
      }
      onDone={onDone}
    />
  );
}
