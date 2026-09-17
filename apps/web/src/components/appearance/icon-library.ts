import { iconNames } from 'lucide-react/dynamic';
import { ICONS } from './appearance';

/**
 * Every icon lucide ships, some two thousand of them, beyond the handful this app bundles.
 *
 * Only their names are bundled: the icons themselves load one at a time, on demand, through
 * lucide's own DynamicIcon (see AppearanceIcon and the picker). Importing them all outright would
 * add about 150 KB gzipped to what every visit downloads, for a picker most people open once.
 */
const LIBRARY_NAMES: readonly string[] = iconNames;

const bundled = new Set(Object.keys(ICONS));

/** Whether lucide has an icon by this name, bundled here or not. */
export function isIconName(name: string): boolean {
  return bundled.has(name) || LIBRARY_NAMES.includes(name);
}

/**
 * The names to offer, `leading` first (the ones this app bundles, in their curated order) and the
 * rest of lucide after, alphabetically. A search term narrows it; words match in any order, so
 * "card credit" finds "credit-card".
 */
export function iconNamesFor(leading: readonly string[], search: string): string[] {
  const seen = new Set(leading);
  const all = [...leading, ...LIBRARY_NAMES.filter((name) => !seen.has(name))];
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return all;
  }
  return all.filter((name) => {
    const words = name.split('-');
    return terms.every((term) => words.some((word) => word.startsWith(term)) || name.includes(term));
  });
}
