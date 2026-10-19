/**
 * The cut map: `docs/survey/cut-table.json` read as the unit each file
 * belongs to, spelled as the table spells it: a `packages` row's `name`,
 * or an `unassigned` entry's `folder` (`src/ci/`). A file's unit is read
 * in three steps, the first that answers winning:
 *
 * 1. The listing: the row whose `files` list the file. When a file is
 *    listed twice, the first listing wins, the `packages` rows read
 *    before the `unassigned` entries.
 * 2. The directory, then the walk: a file listed nowhere takes the unit
 *    of the listed files directly in its own directory
 *    (`posix.dirname(file)`) when every one of them has the same unit; a
 *    directory whose direct listed files span two units goes to step 3.
 *    When its own directory holds no listed file, the walk reads that
 *    directory and then each parent in turn, the repository root (`.`)
 *    never read, by the listed files at any depth below it: the first
 *    directory holding any answers, one unit placing the file and two or
 *    more stopping the walk with no answer, and a directory holding
 *    nothing below it is passed over.
 * 3. The row folders: otherwise the unit of the row whose folder is the
 *    longest prefix of the file's directory, read with its trailing `/`
 *    (so `src/ci/` holds `src/ci/runs2.ts` and not `src/cia/x.ts`), when
 *    exactly one row names that folder. A row's folders are its
 *    `packages[].folders`, or an `unassigned` entry's `folder`.
 *
 * A file is unplaced, its unit `undefined`, when no row lists it, no
 * listed files of one unit lie in its directory or below the nearest
 * folder above it holding any, and no single row names its longest
 * folder: a longest folder two rows name places nothing, and no shorter
 * folder is tried. The fallback steps are computed once when the table
 * is read, so `unitOf` is a lookup.
 *
 * Only `packages[].name`, `packages[].files`, `packages[].folders`
 * (absent read as empty), `unassigned[].folder` and `unassigned[].files`
 * are read; every other key of the table is left alone.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';

/** The cut table read as the unit of each file it lists. */
export interface CutMap {
  /** The path the table was read from, as handed in. */
  readonly path: string;
  /** The sha256 of the table's text, as lowercase hex. */
  readonly sha256: string;
  /** Every package row name and unassigned folder, sorted. */
  readonly units: readonly string[];
  /**
   * The unit of `file`: the row that lists it, else the one unit of its
   * directory's direct listed files, else, when it holds none, the one
   * unit below the nearest folder above it holding any (two units stop
   * the walk, the root never read), else the one row naming its longest
   * folder; `undefined` when none of them places it.
   */
  unitOf(file: string): string | undefined;
  /** The files of `files` the map holds no unit for, sorted and unique. */
  unplaced(files: Iterable<string>): string[];
}

/** One placement read from the table: a unit, the files it lists and the folders it names. */
interface Placement {
  readonly unit: string;
  readonly files: readonly string[];
  readonly folders: readonly string[];
}

/** Whether `value` is a plain object, not an array and not `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is an array holding strings only. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Reads the rows of the table's `list` key, each holding the string key
 * `unitKey` and a `files` array of strings. A `packages` row's folders are
 * its optional `folders` array, absent read as empty; an `unassigned`
 * entry's one folder is its `folder`, which is also its unit.
 *
 * @throws when `list` is not an array, a row lacks either key, or a
 *   `packages` row holds a `folders` that is not an array of strings.
 */
function placementsOf(table: Record<string, unknown>, list: string, unitKey: string, path: string): Placement[] {
  const rows = table[list];
  if (!Array.isArray(rows)) {
    throw new Error(`${path}: the cut table holds no \`${list}\` array`);
  }
  return rows.map((row: unknown, index) => {
    if (!isRecord(row) || typeof row[unitKey] !== 'string') {
      throw new Error(`${path}: \`${list}[${index}]\` holds no string \`${unitKey}\``);
    }
    if (!isStringArray(row.files)) {
      throw new Error(`${path}: \`${list}[${index}]\` holds no \`files\` array of strings`);
    }
    return { files: row.files, folders: foldersOf(row, list, unitKey, `${path}: \`${list}[${index}]\``), unit: row[unitKey] };
  });
}

/**
 * The folders a row names: the `unassigned` entry's `folder`, or a
 * `packages` row's optional `folders`.
 *
 * @throws when a present `folders` is not an array of strings, naming the
 *   row through `where`.
 */
function foldersOf(row: Record<string, unknown>, list: string, unitKey: string, where: string): string[] {
  if (list === 'unassigned') {
    return [row[unitKey] as string];
  }
  if (row.folders === undefined) {
    return [];
  }
  if (!isStringArray(row.folders)) {
    throw new Error(`${where} holds no \`folders\` array of strings`);
  }
  return row.folders;
}

/**
 * The one unit of each directory's listed files, or `undefined` for a
 * directory whose listed files fall in more than one unit.
 */
function directoryUnits(units: ReadonlyMap<string, string>): Map<string, string | undefined> {
  const byDirectory = new Map<string, string | undefined>();
  for (const [file, unit] of units) {
    const directory = posix.dirname(file);
    const seen = byDirectory.get(directory);
    byDirectory.set(directory, byDirectory.has(directory) && seen !== unit
      ? undefined
      : unit);
  }
  return byDirectory;
}

/**
 * The walk's table: each ancestor directory of each listed file, from
 * `posix.dirname(file)` up to and not including the root (`.`), with the
 * one unit of the listed files at any depth below it, or `undefined` once
 * two units are met there.
 */
function ancestorUnits(units: ReadonlyMap<string, string>): Map<string, string | undefined> {
  const byAncestor = new Map<string, string | undefined>();
  for (const [file, unit] of units) {
    for (let directory = posix.dirname(file); isWalked(directory); directory = posix.dirname(directory)) {
      const seen = byAncestor.get(directory);
      byAncestor.set(directory, byAncestor.has(directory) && seen !== unit
        ? undefined
        : unit);
    }
  }
  return byAncestor;
}

/** Whether the walk reads `directory`: never the root `.`, nor `/`. */
function isWalked(directory: string): boolean {
  return directory !== '.' && directory !== '/';
}

/**
 * The walk from `directory` upward: the entry of the first directory
 * `ancestors` holds, `undefined` for a mixed one or when none is held
 * below the root.
 */
function walkedUnit(ancestors: ReadonlyMap<string, string | undefined>, directory: string): string | undefined {
  for (let current = directory; isWalked(current); current = posix.dirname(current)) {
    if (ancestors.has(current)) {
      return ancestors.get(current);
    }
  }
  return undefined;
}

/**
 * Each folder a row names, with the unit of its row, or `undefined` when
 * more than one row names it.
 */
function folderUnits(placements: readonly Placement[]): Map<string, string | undefined> {
  const rows = new Map<string, Set<number>>();
  placements.forEach((placement, index) => {
    for (const folder of placement.folders) {
      rows.set(folder, (rows.get(folder) ?? new Set<number>()).add(index));
    }
  });
  return new Map([...rows].map(([folder, indexes]) => [
    folder,
    indexes.size === 1
      ? placements[[...indexes][0]!]!.unit
      : undefined,
  ]));
}

/**
 * The unit of the longest folder that is a prefix of `directory` read
 * with its trailing `/`; `undefined` when no folder is, or when the
 * longest one is named by two rows.
 */
function longestFolderUnit(folders: ReadonlyMap<string, string | undefined>, directory: string): string | undefined {
  let prefix = `${directory}/`;
  while (prefix.length > 0) {
    if (folders.has(prefix)) {
      return folders.get(prefix);
    }
    prefix = prefix.slice(0, prefix.lastIndexOf('/', prefix.length - 2) + 1);
  }
  return undefined;
}

/** The sha256 of `text`'s UTF-8 bytes, as lowercase hex. */
function sha256Hex(text: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(text)
    .digest('hex');
}

/**
 * Reads a cut table's JSON text into a {@link CutMap}.
 *
 * @param text - the table's text, as read from the file.
 * @param path - the path the text came from, kept on the map and named in
 *   every refusal.
 * @returns the map of each file to its unit, by listing or by folder.
 * @throws when the text is not JSON, is not an object, holds no
 *   `packages` array with a string `name` and a `files` array on each
 *   row (and, when present, a `folders` array of strings), or no
 *   `unassigned` array with a string `folder` and a `files`
 *   array on each entry; the message names what is missing.
 */
export function parseCutMap(text: string, path: string): CutMap {
  let table: unknown;
  try {
    table = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: the cut table is not JSON (${(error as Error).message})`);
  }
  if (!isRecord(table)) {
    throw new Error(`${path}: the cut table is not a JSON object`);
  }
  const placements = [
    ...placementsOf(table, 'packages', 'name', path),
    ...placementsOf(table, 'unassigned', 'folder', path),
  ];
  const units = new Map<string, string>();
  for (const placement of placements) {
    for (const file of placement.files) {
      if (!units.has(file)) {
        units.set(file, placement.unit);
      }
    }
  }
  const directories = directoryUnits(units);
  const ancestors = ancestorUnits(units);
  const folders = folderUnits(placements);
  const unitOf = (file: string): string | undefined => {
    const listed = units.get(file);
    if (listed !== undefined) {
      return listed;
    }
    const directory = posix.dirname(file);
    const nearby = directories.has(directory)
      ? directories.get(directory)
      : walkedUnit(ancestors, directory);
    return nearby ?? longestFolderUnit(folders, directory);
  };
  return {
    path,
    sha256: sha256Hex(text),
    units: [...new Set(placements.map((placement) => placement.unit))].sort(),
    unitOf,
    unplaced: (files) => [...new Set(files)].filter((file) => unitOf(file) === undefined).sort(),
  };
}

/**
 * Reads the cut table at `file` into a {@link CutMap}.
 *
 * @param root - the repository root a relative `file` is read against.
 * @param file - the table's path, absolute or relative to `root`; kept on
 *   the map as handed in.
 * @returns the map of each file to its unit, by listing or by folder.
 * @throws when the file cannot be read, or {@link parseCutMap} refuses it.
 */
export function readCutMap(root: string, file: string): CutMap {
  const absolute = isAbsolute(file)
    ? file
    : join(root, file);
  return parseCutMap(readFileSync(absolute, 'utf8'), file);
}
