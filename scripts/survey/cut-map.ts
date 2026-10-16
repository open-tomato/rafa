/**
 * The cut map: `docs/survey/cut-table.json` read as the unit each file
 * belongs to. A file's unit is the `name` of the `packages` row whose
 * `files` list it, or the `folder` of the `unassigned` entry whose
 * `files` list it (`src/ci/`), spelled as the table spells it. A file the
 * table lists nowhere has no unit and is unplaced.
 *
 * Only `packages[].name`, `packages[].files`, `unassigned[].folder` and
 * `unassigned[].files` are read; every other key of the table is left
 * alone. A row's `folders` play no part: a package that holds three
 * folders and a folder split across two packages are both read from the
 * files each row lists. When a file is listed twice, the first listing
 * wins, the `packages` rows read before the `unassigned` entries.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** The cut table read as the unit of each file it lists. */
export interface CutMap {
  /** The path the table was read from, as handed in. */
  readonly path: string;
  /** The sha256 of the table's text, as lowercase hex. */
  readonly sha256: string;
  /** Every package row name and unassigned folder, sorted. */
  readonly units: readonly string[];
  /** The unit that lists `file`, or `undefined` when none does. */
  unitOf(file: string): string | undefined;
  /** The files of `files` the map holds no unit for, sorted and unique. */
  unplaced(files: Iterable<string>): string[];
}

/** One placement read from the table: a unit and the files it lists. */
interface Placement {
  readonly unit: string;
  readonly files: readonly string[];
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
 * `unitKey` and a `files` array of strings.
 *
 * @throws when `list` is not an array, or a row lacks either key.
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
    return { files: row.files, unit: row[unitKey] };
  });
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
 * @returns the map of each listed file to its unit.
 * @throws when the text is not JSON, is not an object, holds no
 *   `packages` array with a string `name` and a `files` array on each
 *   row, or no `unassigned` array with a string `folder` and a `files`
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
  const unitOf = (file: string): string | undefined => units.get(file);
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
 * @returns the map of each listed file to its unit.
 * @throws when the file cannot be read, or {@link parseCutMap} refuses it.
 */
export function readCutMap(root: string, file: string): CutMap {
  const absolute = isAbsolute(file)
    ? file
    : join(root, file);
  return parseCutMap(readFileSync(absolute, 'utf8'), file);
}
