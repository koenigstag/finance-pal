import { ArrowLeftIcon, ChevronRightIcon, DownloadIcon, UploadIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { OneMoneyImport } from './one-money-import';

type View = 'menu' | 'import' | 'one-money';

interface DataSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Option {
  view: View;
  label: string;
  description?: string;
  icon: LucideIcon;
  soon?: boolean;
}

/**
 * Getting data in and out of the app: a bottom sheet on phones (the dialog's small-screen layout),
 * a dialog from sm up. Its sections open inside it, so closing always returns to where the app was.
 */
export function DataSheet({ open, onOpenChange }: DataSheetProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('menu');

  // Every opening starts at the top of the flow.
  useEffect(() => {
    if (open) {
      setView('menu');
    }
  }, [open]);

  const options: Record<'menu' | 'import', Option[]> = {
    menu: [
      { view: 'import', label: t('data.import.title'), description: t('data.import.description'), icon: UploadIcon },
      { view: 'menu', label: t('data.export.title'), description: t('data.export.description'), icon: DownloadIcon, soon: true },
    ],
    import: [{ view: 'one-money', label: t('data.import.oneMoney.title'), description: t('data.import.oneMoney.short'), icon: WalletIcon }],
  };

  const titles: Record<View, string> = {
    menu: t('data.title'),
    import: t('data.import.title'),
    'one-money': t('data.import.oneMoney.title'),
  };
  const back: Record<View, View | null> = { menu: null, import: 'menu', 'one-money': 'import' };

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
              <DialogDescription className="truncate">
                {view === 'one-money' ? t('data.import.title') : t('data.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {view === 'one-money' ? (
          <OneMoneyImport onDone={() => onOpenChange(false)} />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {options[view].map(({ view: target, label, description, icon: Icon, soon }) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={soon}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-transparent"
                  onClick={() => setView(target)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      {label}
                      {soon && <Badge variant="secondary">{t('data.soon')}</Badge>}
                    </span>
                    {description && <span className="block truncate text-sm text-muted-foreground">{description}</span>}
                  </span>
                  {!soon && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
