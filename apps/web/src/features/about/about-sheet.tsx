import { CodeIcon, WalletIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { APP_COMMIT, APP_VERSION, REPOSITORY_URL, commitUrl, shortCommit } from '@/lib/build-info';

interface AboutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What the app is, and which build of it this is: a bottom sheet on phones (the dialog's
 * small-screen layout), a dialog from sm up.
 *
 * The version and the commit are the reason it exists. An installed app keeps running the bundle
 * it already has until the next start picks up a new one, so "the latest" is never a safe
 * assumption — a bug report that names the commit says exactly what was on screen.
 */
export function AboutSheet({ open, onOpenChange }: AboutSheetProps) {
  const { t } = useTranslation();
  const commitHref = commitUrl(APP_COMMIT);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* Room on the right for the close button, which sits over the header's corner. */}
          <div className="flex items-center gap-3 pr-8 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <WalletIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{t('app.name')}</DialogTitle>
              <DialogDescription className="truncate">{t('app.tagline')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <p className="text-muted-foreground">{t('about.description')}</p>

        <dl className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('about.version')}</dt>
            <dd className="font-mono">{APP_VERSION}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('about.commit')}</dt>
            <dd className="min-w-0 truncate font-mono">
              {commitHref ? (
                <a href={commitHref} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {shortCommit(APP_COMMIT)}
                </a>
              ) : (
                // A build made without the git history — from a source tarball, say — knows no commit.
                <span className="text-muted-foreground">{t('about.noCommit')}</span>
              )}
            </dd>
          </div>
        </dl>

        <Button variant="outline" asChild>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            <CodeIcon />
            {t('about.source')}
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
