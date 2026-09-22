import { ArrowLeftIcon, ChevronRightIcon, DownloadIcon, FileSpreadsheetIcon, UploadIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DataExport } from './data-export';
import { FinancePalImport } from './finance-pal-import';
import { OneMoneyImport } from './one-money-import';

type View = 'menu' | 'import' | 'export' | 'finance-pal' | 'one-money';

interface DataSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The group the app is on: what an export takes unless another is picked.
  currentGroupId?: string;
}

interface Option {
  view: View;
  label: string;
  description?: string;
  icon: LucideIcon;
}

/**
 * Getting data in and out of the app: a bottom sheet on phones (the dialog's small-screen layout),
 * a dialog from sm up. Its sections open inside it, so closing always returns to where the app was.
 */
export function DataSheet({ open, onOpenChange, currentGroupId }: DataSheetProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('menu');

  // Every opening starts at the top of the flow.
  useEffect(() => {
    if (open) {
      setView('menu');
    }
  }, [open]);

  const options: Partial<Record<View, Option[]>> = {
    menu: [
      { view: 'import', label: t('data.import.title'), description: t('data.import.description'), icon: UploadIcon },
      { view: 'export', label: t('data.export.title'), description: t('data.export.description'), icon: DownloadIcon },
    ],
    import: [
      {
        view: 'finance-pal',
        label: t('data.import.financePal.title'),
        description: t('data.import.financePal.short'),
        icon: FileSpreadsheetIcon,
      },
      { view: 'one-money', label: t('data.import.oneMoney.title'), description: t('data.import.oneMoney.short'), icon: WalletIcon },
    ],
  };

  const titles: Record<View, string> = {
    menu: t('data.title'),
    import: t('data.import.title'),
    export: t('data.export.title'),
    'finance-pal': t('data.import.financePal.title'),
    'one-money': t('data.import.oneMoney.title'),
  };
  const subtitles: Record<View, string> = {
    menu: t('data.description'),
    import: t('data.import.description'),
    export: t('data.export.description'),
    'finance-pal': t('data.import.title'),
    'one-money': t('data.import.title'),
  };
  const back: Record<View, View | null> = { menu: null, import: 'menu', export: 'menu', 'finance-pal': 'import', 'one-money': 'import' };
  const done = () => onOpenChange(false);
  const listed = options[view];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-sm:top-0 max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none max-sm:pt-[calc(1rem+env(safe-area-inset-top))]">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            {back[view] && (
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2"
                aria-label={t('common.back')}
                onClick={() => setView(back[view] ?? 'menu')}
              >
                <ArrowLeftIcon />
              </Button>
            )}
            <div className="min-w-0 flex-1 text-left">
              <DialogTitle className="truncate">{titles[view]}</DialogTitle>
              <DialogDescription className="truncate">{subtitles[view]}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {view === 'one-money' && <OneMoneyImport onDone={done} />}
        {view === 'finance-pal' && <FinancePalImport onDone={done} />}
        {view === 'export' && <DataExport currentGroupId={currentGroupId} />}
        {listed && (
          <ul className="-mx-2 flex flex-col">
            {listed.map(({ view: target, label, description, icon: Icon }) => (
              <li key={target}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => setView(target)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    {description && <span className="block truncate text-sm text-muted-foreground">{description}</span>}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
