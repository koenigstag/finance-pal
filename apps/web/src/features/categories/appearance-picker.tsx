import { CheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS, CATEGORY_ICON_NAMES, CATEGORY_ICONS } from './category-appearance';

interface IconPickerProps {
  id: string;
  value: string | null;
  color: string | null;
  onChange: (icon: string) => void;
}

/** A grid of the category icons, drawn in the chosen color. A radio group: one icon at a time. */
export function IconPicker({ id, value, color, onChange }: IconPickerProps) {
  const { t } = useTranslation();

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={t('categories.icon')}
      className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto rounded-lg border p-1 sm:grid-cols-8"
    >
      {CATEGORY_ICON_NAMES.map((name) => {
        const Icon = CATEGORY_ICONS[name];
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            // The stored name reads well enough ("shopping cart"), and it's what the icon is.
            aria-label={name.replace(/-/g, ' ')}
            onClick={() => onChange(name)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-5',
              selected ? 'bg-muted ring-2 ring-ring' : 'text-muted-foreground',
            )}
            style={selected && color ? { color } : undefined}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

interface ColorPickerProps {
  id: string;
  value: string | null;
  onChange: (color: string) => void;
}

/** Swatches of the category palette. */
export function ColorPicker({ id, value, onChange }: ColorPickerProps) {
  const { t } = useTranslation();

  return (
    <div id={id} role="radiogroup" aria-label={t('categories.color')} className="flex flex-wrap gap-2">
      {CATEGORY_COLORS.map((color) => {
        const selected = color.toLowerCase() === value?.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            onClick={() => onChange(color)}
            className="flex size-9 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition-transform focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none md:size-7 aria-checked:ring-2 aria-checked:ring-foreground"
            style={{ backgroundColor: color }}
          >
            {selected && <CheckIcon className="size-4" />}
          </button>
        );
      })}
    </div>
  );
}
