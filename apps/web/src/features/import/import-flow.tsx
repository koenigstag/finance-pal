import type { UseMutationResult } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api/client';
import type { ImportSummary } from './queries';

interface ImportFlowProps {
  // What to do, a step a line.
  steps: string[];
  // Names the file input.
  fileLabel: string;
  accept?: string;
  // Several files at once: the CSV files of one export, say.
  multiple?: boolean;
  importer: UseMutationResult<ImportSummary, Error, File[]>;
  // Under the steps: where to read more.
  hint?: ReactNode;
  onDone: () => void;
}

/** Choosing the file(s) to import and what came of it: the last step of every import. */
export function ImportFlow({ steps, fileLabel, accept, multiple = false, importer, hint, onDone }: ImportFlowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const error = importer.error;
  const message =
    // 413 comes from whatever sits in front of the API, in its own words; say it plainly instead.
    error instanceof ApiError && error.status === 413
      ? t('data.import.tooLarge')
      : // The API says what it couldn't read — a currency it has no code for, a row that doesn't
        // add up — a line each, and that's more use than a generic failure.
        error instanceof ApiError && error.status < 500 && error.message
        ? error.message
        : importer.isError
          ? t('errors.generic')
          : null;

  if (summary) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <p className="font-medium">{summary.groupName}</p>
          <p className="text-sm text-muted-foreground">
            {t('data.import.counts', {
              accounts: summary.accounts,
              categories: summary.categories,
              transactions: summary.transactions,
            })}
          </p>
          {summary.recurringRules > 0 && (
            <p className="text-sm text-muted-foreground">{t('data.import.series', { count: summary.recurringRules })}</p>
          )}
          {summary.openingBalances > 0 && (
            <p className="text-sm text-muted-foreground">{t('data.import.openingBalances', { count: summary.openingBalances })}</p>
          )}
        </div>
        {/* The balances the import came out with, to hold against where it came from. */}
        <ul className="flex flex-col divide-y rounded-xl border">
          {summary.balances.map((account, index) => (
            <li key={`${index}-${account.name}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
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
          {t('data.import.open')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {hint}
      <Input
        type="file"
        aria-label={fileLabel}
        accept={accept}
        multiple={multiple}
        disabled={importer.isPending}
        onChange={(event) => {
          setFiles([...(event.target.files ?? [])]);
          importer.reset();
        }}
      />
      {message && (
        <Alert variant="destructive">
          {/* A file with several problems gets a line for each. */}
          <AlertDescription className="max-h-60 overflow-y-auto whitespace-pre-line">{message}</AlertDescription>
        </Alert>
      )}
      <Button
        className="mt-auto"
        disabled={files.length === 0 || importer.isPending}
        onClick={() => importer.mutate(files, { onSuccess: setSummary })}
      >
        {importer.isPending ? <Spinner /> : <UploadIcon />}
        {t(importer.isPending ? 'data.import.importing' : 'data.import.submit')}
      </Button>
    </div>
  );
}
