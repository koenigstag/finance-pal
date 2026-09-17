import { ArrowLeftRightIcon, CircleDashedIcon, ShapesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_ICONS, categoryColor } from './category-appearance';

const SIZES = {
  sm: 'size-6 [&_svg]:size-3.5',
  md: 'size-8 [&_svg]:size-4',
  lg: 'size-10 [&_svg]:size-5',
} as const;

interface CategoryIconProps {
  icon?: string | null;
  color?: string | null;
  // What a row without a category shows: nothing chosen, or a transfer between accounts.
  placeholder?: 'none' | 'transfer';
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * A category's icon on a disc tinted with its color. Decorative: the category's name is always
 * shown next to it, so it's hidden from assistive technology.
 */
export function CategoryIcon({ icon, color, placeholder, size = 'md', className }: CategoryIconProps) {
  const tint = categoryColor(color);
  const Icon = placeholder === 'transfer' ? ArrowLeftRightIcon : placeholder === 'none' ? CircleDashedIcon : (icon && CATEGORY_ICONS[icon]) || ShapesIcon;

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        !tint && 'bg-muted text-muted-foreground',
        SIZES[size],
        className,
      )}
      // The color at about 15% opacity behind the icon in full color: legible in light and dark.
      style={tint ? { backgroundColor: `${tint}26`, color: tint } : undefined}
    >
      <Icon />
    </span>
  );
}
