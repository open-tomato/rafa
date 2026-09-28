/**
 * `ts-symbols outline` answers kept by the content of the file outlined,
 * so a file that has not changed is never outlined twice.
 *
 * The references check confirms a symbol by outlining each candidate file
 * (`./verify.ts`), and every outline starts a process that loads the
 * TypeScript compiler. Measured on 2026-09-28, `rafa roadmap` ran 26
 * outlines for 19.4 s of its 37 s, and 65.8 s of CPU against 4.2 s with
 * `ts-symbols` off the `PATH`. An outline is a reading of one file's text:
 * the names it exports at its top level, re-exports included, and nothing
 * outside the file. So the key is the sha256 of the file's bytes, and a
 * kept answer can never be stale: a changed file has another key.
 *
 * ## The files
 *
 * One JSON list of names per key under {@link OUTLINE_CACHE_DIR}, which
 * carries the shape version in its last segment, so a later shape reads
 * as no cache rather than as a wrong one. A file is written whole through
 * a temporary file and a rename.
 *
 * ## What is never kept
 *
 * An outline that answered null — the file could not be outlined — is
 * answered and not kept, so the next check asks again. A file that
 * cannot be read is outlined as if there were no cache. Nothing here
 * throws: a kept answer that cannot be read or written costs the next
 * check an outline, never an answer.
 */
import type { SymbolOutliner } from './verify.js';

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SCOPE_DIR } from '../project/scope.js';

/** Where kept outlines are written, relative to the project root. */
export const OUTLINE_CACHE_DIR = join(SCOPE_DIR, 'cache', 'outline', 'v1');

/** The kept names in `path`, or null when there are none this version can read. */
function readKept(path: string): readonly string[] | null {
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(payload) && payload.every((name) => typeof name === 'string')
      ? payload
      : null;
  } catch {
    return null;
  }
}

/** Keeps `names` at `path`, whole; nothing is thrown when it cannot. */
function keep(path: string, dir: string, names: readonly string[]): void {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(temporary, JSON.stringify(names));
    renameSync(temporary, path);
  } catch {
    // A write that fails costs the next check an outline; see the module note.
  }
}

/** The sha256 of `file`'s bytes under `root`, or null when it cannot be read. */
function contentKey(root: string, file: string): string | null {
  try {
    return createHash('sha256')
      .update(readFileSync(resolve(root, file)))
      .digest('hex');
  } catch {
    return null;
  }
}

/**
 * `outline` with each answer kept under `root` by the content of the file
 * outlined; null stays null, since there is nothing to keep. See the
 * module note.
 */
export function withOutlineCache(outline: SymbolOutliner | null, root: string): SymbolOutliner | null {
  if (outline === null) return null;
  const dir = join(root, OUTLINE_CACHE_DIR);
  return async (file) => {
    const key = contentKey(root, file);
    if (key === null) return outline(file);
    const path = join(dir, `${key}.json`);
    const kept = readKept(path);
    if (kept !== null) return kept;
    const names = await outline(file);
    if (names !== null) keep(path, dir, names);
    return names;
  };
}
