import { ArrowLeftRightIcon, CircleDashedIcon, ShapesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICONS, validColor } from './appearance';

const SIZES = {
  sm: 'size-6 [&_svg]:size-3.5',
  md: 'size-8 [&_svg]:size-4',
  lg: 'size-10 [&_svg]:size-5',
} as const;

interface AppearanceIconProps {
  icon?: string | null;
  color?: string | null;
  // What to show instead of a stored icon: nothing chosen (an uncategorized transaction), or a
  // transfer between accounts.
  placeholder?: 'none' | 'transfer';
  // The icon for one with none (or an unknown name) stored: a wallet suits an account better than
  // the generic shape.
  fallbackIcon?: string;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * An account's or category's icon on a disc tinted with its color. Decorative: the name is always
 * shown next to it, so it's hidden from assistive technology.
 */
export function AppearanceIcon({ icon, color, placeholder, fallbackIcon, size = 'md', className }: AppearanceIconProps) {
  const tint = validColor(color);
  const Icon =
    placeholder === 'transfer'
      ? ArrowLeftRightIcon
      : placeholder === 'none'
        ? CircleDashedIcon
        : (icon && ICONS[icon]) || (fallbackIcon && ICONS[fallbackIcon]) || ShapesIcon;

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
