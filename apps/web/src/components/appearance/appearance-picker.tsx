import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COLORS, ICONS } from './appearance';

interface IconPickerProps {
  id: string;
  label: string;
  // Which icons, in which order.
  names: readonly string[];
  value: string | null;
  color: string | null;
  onChange: (icon: string) => void;
}

/** A grid of icons, the chosen one drawn in the chosen color. A radio group: one icon at a time. */
export function IconPicker({ id, label, names, value, color, onChange }: IconPickerProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto rounded-lg border p-1 sm:grid-cols-8"
    >
      {names.map((name) => {
        const Icon = ICONS[name];
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            // The stored name reads well enough ("piggy bank"), and it's what the icon is.
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
  label: string;
  value: string | null;
  onChange: (color: string) => void;
}

/** Swatches of the palette. */
export function ColorPicker({ id, label, value, onChange }: ColorPickerProps) {
  return (
    <div id={id} role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {COLORS.map((color) => {
        const selected = color.toLowerCase() === value?.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            onClick={() => onChange(color)}
            className="flex size-9 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition-transform focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none aria-checked:ring-2 aria-checked:ring-foreground md:size-7"
            style={{ backgroundColor: color }}
          >
            {selected && <CheckIcon className="size-4" />}
          </button>
        );
      })}
    </div>
  );
}
