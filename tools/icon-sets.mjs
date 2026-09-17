import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Turns the icon packages into data the app can fetch a slice of at a time.
 *
 * Bundling five thousand icons into the app is out of the question, and a file per icon would put
 * ten thousand of them into every deploy. So each set is written as shards keyed by first letter —
 * a few dozen files, a few tens of kilobytes each — plus an index of names for the picker's search.
 * A row showing one icon pulls one shard; the picker pulls what the search lands on.
 *
 * Generated into the app's public directory at build (and dev) time, and never committed: the
 * packages are the source of truth, and this keeps them in step.
 */
const require = createRequire(import.meta.url);

// Digits and anything else share one shard; only a-z get their own.
const shardOf = (name) => (/^[a-z]/.test(name) ? name[0] : '0');

function shard(entries) {
  const shards = {};
  for (const [name, value] of entries) {
    (shards[shardOf(name)] ??= {})[name] = value;
  }
  return shards;
}

async function writeSet(outDir, set, entries, index) {
  const dir = join(outDir, set);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), JSON.stringify(index));
  for (const [key, icons] of Object.entries(shard(entries))) {
    await writeFile(join(dir, `${key}.json`), JSON.stringify(icons));
  }
  return entries.length;
}

/** Tabler's outline set: 24px, stroked, drawn like lucide. */
async function tablerEntries() {
  // The package maps './*' onto './icons/*', so a bare specifier already points inside icons/.
  const dir = dirname(require.resolve('@tabler/icons/outline/rocket.svg'));
  const files = (await readdir(dir)).filter((file) => file.endsWith('.svg'));
  const entries = [];
  for (const file of files) {
    const svg = await readFile(join(dir, file), 'utf8');
    const inner = svg
      .slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
      // Every Tabler icon opens with a transparent square that only pads the viewBox.
      .replace(/<path stroke="none"[^/]*\/>/, '')
      .replace(/\s+/g, ' ')
      .trim();
    entries.push([file.replace(/\.svg$/, ''), inner]);
  }
  return entries;
}

/** Simple Icons: brand marks, one filled path each, with the brand's own color. */
async function simpleEntries() {
  const icons = require('simple-icons');
  return Object.values(icons)
    .filter((icon) => icon?.slug && icon.path)
    .map((icon) => [icon.slug, { t: icon.title, p: icon.path, c: icon.hex }])
    .sort(([a], [b]) => a.localeCompare(b));
}

export async function buildIconSets(outDir) {
  const tabler = await tablerEntries();
  const simple = await simpleEntries();
  await writeSet(
    outDir,
    'tabler',
    tabler,
    tabler.map(([name]) => name),
  );
  await writeSet(
    outDir,
    'simple',
    simple,
    // The title is what people search a brand by ("PayPal"), the slug is what gets stored.
    simple.map(([slug, icon]) => [slug, icon.t]),
  );
  return { tabler: tabler.length, simple: simple.length };
}

/** Keeps the generated sets in step with the packages, in dev and in a build alike. */
export function iconSetsPlugin(outDir) {
  return {
    name: 'ft-icon-sets',
    async buildStart() {
      await buildIconSets(outDir);
    },
  };
}
