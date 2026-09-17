import { StarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavouriteToggleProps {
  favourite: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The account dialog's star: filled for the favourite account (preselected for new transactions),
 * outlined otherwise.
 */
export function FavouriteToggle({ favourite, onToggle, disabled, className }: FavouriteToggleProps) {
  const { t } = useTranslation();

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
      <StarIcon className={cn('transition-colors', favourite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
    </Button>
  );
}
