import { useSyncExternalStore } from 'react';

/**
 * Icons beyond the ones this app bundles, fetched as they're needed.
 *
 * A stored icon name may carry the set it comes from: "tabler:rocket", "simple:paypal". A bare
 * name ("piggy-bank") is lucide, which is what every icon stored before these sets existed is, so
 * nothing had to be rewritten.
 *
 * The sets are generated into /icons at build time (tools/icon-sets.mjs) as shards keyed by first
 * letter, plus an index of names for the picker. A row showing one icon fetches one shard; nothing
 * is downloaded until something asks.
 */
export const ICON_SETS = ['tabler', 'simple'] as const;

export type IconSet = (typeof ICON_SETS)[number];

export interface SetIcon {
  // Tabler: the markup inside the <svg>. Simple Icons: one path, and the brand's own color.
  markup?: string;
  path?: string;
  title?: string;
  color?: string;
}

export interface ParsedIconName {
  set: IconSet | null;
  name: string;
}

/** "tabler:rocket" → { set: 'tabler', name: 'rocket' }; a bare name belongs to lucide. */
export function parseIconName(stored: string): ParsedIconName {
  const [prefix, ...rest] = stored.split(':');
  const set = ICON_SETS.find((candidate) => candidate === prefix);
  const name = rest.join(':');
  return set && name ? { set, name } : { set: null, name: stored };
}

export const iconName = (set: IconSet | null, name: string) => (set ? `${set}:${name}` : name);

// Digits and anything else share one shard, as the generator writes them.
const shardOf = (name: string) => (/^[a-z]/.test(name) ? name[0] : '0');

type Shard = Record<string, string | { t: string; p: string; c: string }>;

const shards = new Map<string, Shard>();
const indexes = new Map<IconSet, [string, string][]>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}icons/${path}`);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    // Offline, or the set wasn't generated: the caller keeps the placeholder.
    return null;
  }
}

function load<T>(key: string, path: string, keep: (value: T) => void): void {
  if (pending.has(key)) {
    return;
  }
  pending.set(
    key,
    fetchJson<T>(path).then((value) => {
      if (value) {
        keep(value);
        notify();
      }
    }),
  );
}

/** One icon's drawing, once its shard is here; loading starts on the first call that wants it. */
export function useSetIcon(set: IconSet, name: string): SetIcon | null {
  const key = `${set}/${shardOf(name)}`;
  useSyncExternalStore(subscribe, () => shards.get(key), () => undefined);
  const shard = shards.get(key);
  if (!shard) {
    load<Shard>(key, `${key}.json`, (value) => shards.set(key, value));
    return null;
  }
  const entry = shard[name];
  if (typeof entry === 'string') {
    return { markup: entry };
  }
  return entry ? { path: entry.p, title: entry.t, color: `#${entry.c}` } : null;
}

/**
 * Every name in a set, with what to search it by — for Simple Icons the brand's name ("PayPal"),
 * which is not always its slug ("paypal" is, "1password" isn't).
 */
export function useIconIndex(set: IconSet | null): [string, string][] | null {
  useSyncExternalStore(subscribe, () => (set ? indexes.get(set) : undefined), () => undefined);
  if (!set) {
    return null;
  }
  const index = indexes.get(set);
  if (!index) {
    load<string[] | [string, string][]>(`index/${set}`, `${set}/index.json`, (value) =>
      indexes.set(
        set,
        value.map((entry) => (typeof entry === 'string' ? [entry, entry] : entry)),
      ),
    );
    return null;
  }
  return index;
}

/**
 * Names matching a search, those starting with it first: they share a shard, so a typical search
 * pulls one file rather than the whole alphabet.
 */
export function searchIcons(index: [string, string][], search: string, limit: number): string[] {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return index.slice(0, limit).map(([name]) => name);
  }
  const starts: string[] = [];
  const contains: string[] = [];
  for (const [name, title] of index) {
    const haystack = `${name} ${title.toLowerCase()}`;
    if (!terms.every((term) => haystack.includes(term))) {
      continue;
    }
    (name.startsWith(terms[0]) || title.toLowerCase().startsWith(terms[0]) ? starts : contains).push(name);
    if (starts.length >= limit) {
      break;
    }
  }
  return [...starts, ...contains].slice(0, limit);
}
