import { StarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavouriteToggleProps {
  favourite: boolean;
  // Absent for callers who can't change it: the star then only shows the state.
  onToggle?: () => void;
  disabled?: boolean;
  className?: string;
}

/** A star: filled for the favourite account (preselected for new transactions), outlined otherwise. */
export function FavouriteToggle({ favourite, onToggle, disabled, className }: FavouriteToggleProps) {
  const { t } = useTranslation();
  const star = (
    <StarIcon className={cn('transition-colors', favourite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
  );

  if (!onToggle) {
    return favourite ? (
      <span role="img" aria-label={t('accounts.favourite')} className={cn('inline-flex size-10 items-center justify-center md:size-8 [&_svg]:size-4', className)}>
        {star}
      </span>
    ) : null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={favourite}
      aria-label={t(favourite ? 'accounts.unmarkFavourite' : 'accounts.markFavourite')}
      title={t('accounts.favouriteDescription')}
      disabled={disabled}
      onClick={onToggle}
      className={className}
    >
      {star}
    </Button>
  );
}
