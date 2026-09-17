import { CheckIcon, SearchIcon } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { COLORS, ICONS } from './appearance';
import { iconNamesFor } from './icon-library';
import { iconName, searchIcons, useIconIndex, type IconSet } from './icon-sets';
import { FetchedIcon } from './set-icon';

// Enough to scroll through; a narrower search brings the rest into reach, and every icon past the
// bundled ones is a request of its own.
const SHOWN_AT_MOST = 120;

// Which set the grid is showing: this app's own (lucide), or one of the fetched ones.
const SOURCES = [null, 'tabler', 'simple'] as const;

interface IconPickerProps {
  id: string;
  label: string;
  // The icons to lead with, in order; the rest of lucide follows, and the other sets are a tab away.
  names: readonly string[];
  value: string | null;
  color: string | null;
  onChange: (icon: string) => void;
}

/**
 * A grid of icons with the chosen one drawn in the chosen color. Three sources: the app's own
 * (lucide, the familiar ones first), Tabler's outlines, and brand marks. Searching narrows the
 * current one; what isn't bundled is fetched as it's shown.
 */
export function IconPicker({ id, label, names, value, color, onChange }: IconPickerProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<IconSet | null>(null);
  const [query, setQuery] = useState('');
  // Typing stays smooth while a couple of thousand names are filtered and drawn.
  const search = useDeferredValue(query).trim().toLowerCase();
  const index = useIconIndex(source);
  const shown = useMemo(() => {
    if (!source) {
      return iconNamesFor(names, search).slice(0, SHOWN_AT_MOST);
    }
    return index ? searchIcons(index, search, SHOWN_AT_MOST) : [];
  }, [source, index, names, search]);

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={source ?? 'app'}
        onValueChange={(next) => next && setSource(next === 'app' ? null : (next as IconSet))}
      >
        {SOURCES.map((option) => (
          <ToggleGroupItem key={option ?? 'app'} value={option ?? 'app'} className="flex-1">
            {t(`appearance.sources.${option ?? 'app'}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-8"
          placeholder={t('appearance.searchIcons')}
          aria-label={t('appearance.searchIcons')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div
        id={id}
        role="radiogroup"
        aria-label={label}
        className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto rounded-lg border p-1 sm:grid-cols-8"
      >
        {shown.map((name) => {
          const stored = iconName(source, name);
          const Icon = source ? null : ICONS[name];
          const selected = stored === value;
          return (
            <button
              key={stored}
              type="button"
              role="radio"
              aria-checked={selected}
              // The stored name reads well enough ("piggy bank"), and it's what the icon is.
              aria-label={name.replace(/-/g, ' ')}
              title={name.replace(/-/g, ' ')}
              onClick={() => onChange(stored)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-5',
                selected ? 'bg-muted ring-2 ring-ring' : 'text-muted-foreground',
              )}
              style={selected && color ? { color } : undefined}
            >
              {Icon ? <Icon /> : source ? <FetchedIcon set={source} name={name} /> : <DynamicIcon name={name as never} />}
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="col-span-full p-2 text-sm text-muted-foreground">
            {t(index || !source ? 'appearance.noIcons' : 'appearance.loadingIcons')}
          </p>
        )}
      </div>
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
