/**
 * The two readers whose answers the check resolver (`./checks.ts`) is
 * handed: the preload files `bunfig.toml` names, and the project's test
 * files. Each opens files, which is why they sit apart from
 * `resolveChecks`, so that it stays pure.
 *
 * ## The two readers
 *
 * {@link readPreloadFiles} reads `bunfig.toml` at the root, parsed with
 * `Bun.TOML`. Only `[test] preload` is read: on bun 1.4.2 `bun test`
 * ran a `[test] preload` file and did NOT run a top-level `preload` one,
 * which `bun <file>` did run. The value may be one string or a list; an
 * entry is taken relative to the root, and one outside it is dropped,
 * since no diff path can name it. A missing file answers no preload; one
 * that does not parse answers none too, as `unreadable` with the reason,
 * never a throw.
 *
 * {@link listTestFiles} walks the root for the files `bun test` finds,
 * measured on bun 1.4.2: a name with `.test`, `_test`, `.spec` or
 * `_spec` before a `ts`, `tsx`, `js`, `jsx`, `mts`, `cts`, `mjs` or
 * `cjs` extension, outside `node_modules` and outside any folder whose
 * name opens with a dot. The walk does not follow symbolic links.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { normaliseFolder } from '@open-tomato/rafa-board';

/** The file whose `[test] preload` names preload files, at the root. */
export const BUNFIG_FILE = 'bunfig.toml';

/** A file name `bun test` runs; see the module note. */
const TEST_FILE_NAME = /[._](?:test|spec)\.(?:tsx?|jsx?|[cm][jt]s)$/;

/** The folder the walk never enters, beside dot folders. */
const DEPENDENCY_FOLDER = 'node_modules';

/** How `bunfig.toml` read. */
export type PreloadReading =
  | { readonly state: 'read' | 'missing'; readonly files: readonly string[] }
  | { readonly state: 'unreadable'; readonly files: readonly string[]; readonly reason: string };

/** `paths`, each once, sorted, as a new list. */
function sortedUnique(paths: Iterable<string>): readonly string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

/** `entry`, a preload entry, repo-relative, or null when it lies outside `root`. */
function preloadPath(root: string, entry: string): string | null {
  const path = isAbsolute(entry)
    ? relative(root, entry).split(sep)
      .join('/')
    : entry;
  const repoRelative = normaliseFolder(path);
  if (repoRelative === '' || isAbsolute(repoRelative)) return null;
  return repoRelative.split('/').includes('..')
    ? null
    : repoRelative;
}

/** A `preload` value's entries: one string, or the strings of a list. */
function preloadEntries(preload: unknown): readonly string[] {
  if (typeof preload === 'string') return [preload];
  if (!Array.isArray(preload)) return [];
  return preload.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The preload files `text`, a `bunfig.toml`, names under `[test]`,
 * repo-relative to `root`, in the order written. Throws what `Bun.TOML`
 * throws for text that does not parse.
 */
export function preloadFilesOf(text: string, root: string): readonly string[] {
  const parsed: unknown = Bun.TOML.parse(text);
  const testTable = (parsed as { readonly test?: unknown }).test;
  if (typeof testTable !== 'object' || testTable === null) return [];
  const preload = (testTable as { readonly preload?: unknown }).preload;
  const paths = preloadEntries(preload).map((entry) => preloadPath(root, entry));
  return paths.filter((path): path is string => path !== null);
}

/** The preload files `bunfig.toml` at `root` names. Never throws. */
export function readPreloadFiles(root: string): PreloadReading {
  const path = join(root, BUNFIG_FILE);
  if (!existsSync(path)) return { state: 'missing', files: [] };
  try {
    return { state: 'read', files: preloadFilesOf(readFileSync(path, 'utf8'), root) };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    return { state: 'unreadable', files: [], reason };
  }
}

/** The files `bun test` finds under `root`, repo-relative and sorted. See the module note. */
export function listTestFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder === ''
        ? entry.name
        : `${folder}/${entry.name}`;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== DEPENDENCY_FOLDER) walk(path);
      else if (entry.isFile() && TEST_FILE_NAME.test(entry.name)) found.push(path);
    }
  };
  walk('');
  return sortedUnique(found);
}
