import { UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';
import { useImportOneMoney, type ImportSummary } from './queries';

/** Picking a 1Money backup and what came of it: the last step of the import flow. */
export function OneMoneyImport({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const importBackup = useImportOneMoney();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const error = importBackup.error;
  const message =
    // 413 comes from whatever sits in front of the API, in its own words; say it plainly instead.
    error instanceof ApiError && error.status === 413
      ? t('data.import.oneMoney.tooLarge')
      : // The API says what it couldn't read — a currency it has no code for, or a file that isn't
        // a backup — and that's more use than a generic failure.
        error instanceof ApiError && error.status < 500 && error.message
        ? error.message
        : importBackup.isError
          ? t('errors.generic')
          : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {summary ? (
        <>
          <div>
            <p className="font-medium">{summary.groupName}</p>
            <p className="text-sm text-muted-foreground">
              {t('data.import.oneMoney.counts', {
                accounts: summary.accounts,
                categories: summary.categories,
                transactions: summary.transactions,
              })}
            </p>
          </div>
          {/* The balances the import came out with, to hold against the app it came from. */}
          <ul className="flex flex-col divide-y rounded-xl border">
            {summary.balances.map((account) => (
              <li key={account.name} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{account.name}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {account.balance} {account.currency}
                </span>
              </li>
            ))}
          </ul>
          <Button
            className="mt-auto"
            onClick={() => {
              onDone();
              void navigate(`/g/${summary.groupId}`);
            }}
          >
            {t('data.import.oneMoney.open')}
          </Button>
        </>
      ) : (
        <>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>{t('data.import.oneMoney.step1')}</li>
            <li>{t('data.import.oneMoney.step2')}</li>
            <li>{t('data.import.oneMoney.step3')}</li>
          </ol>
          <Input
            ref={inputRef}
            type="file"
            aria-label={t('data.import.oneMoney.file')}
            disabled={importBackup.isPending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              importBackup.reset();
            }}
          />
          {message && (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Button
            className="mt-auto"
            disabled={!file || importBackup.isPending}
            onClick={() => file && importBackup.mutate(file, { onSuccess: setSummary })}
          >
            {importBackup.isPending ? <Spinner /> : <UploadIcon />}
            {t(importBackup.isPending ? 'data.import.oneMoney.importing' : 'data.import.oneMoney.submit')}
          </Button>
        </>
      )}
    </div>
  );
}
