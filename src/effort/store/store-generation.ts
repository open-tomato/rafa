/**
 * The store's side record: a small file beside the store file that holds
 * the store's current generation, so a writing open can tell whether the
 * file it opened is the one the generation was last written into.
 *
 * ## Where it lives
 *
 * {@link storeGenerationPath} names it: the store file's path with
 * `.generation` appended, in the same directory (`effort.sqlite` has
 * `effort.sqlite.generation`). The name is built from the path the
 * caller passes, with no symlink resolved, so one store opened through
 * two spellings of its path reads two side records; a caller that wants
 * one passes the store's real path.
 *
 * ## Why a file beside the store
 *
 * The store also records its generation in `store_meta.generation`. A
 * copy of the store file carries that row with it, but not the side
 * record, which stays beside the original. So a file whose row and side
 * record disagree, or whose side record is absent, is not the file the
 * generation was last written into. This module only reads and writes
 * the record; the decision lives in `store-identity.ts`.
 *
 * ## Reading
 *
 * {@link readStoreGeneration} answers the generation, trimmed, or null
 * when the record is absent or holds nothing but whitespace. Null is the
 * answer every caller treats as "no side record". Any other filesystem
 * error (the path is a directory, the file is unreadable) is thrown as
 * the filesystem's own error, which names the path, because a record
 * that exists and cannot be read is no evidence either way.
 *
 * ## Writing
 *
 * {@link writeStoreGeneration} writes the generation and a newline to a
 * temporary file in the same directory, then renames it over the record.
 * A rename within one directory replaces the file whole, so a reader
 * sees the old generation or the new one, never a partial write. When
 * the write or the rename fails, the temporary file is removed and the
 * error is thrown. A generation that is empty, padded with whitespace or
 * spans lines is refused before anything is written: the read trims and
 * reads an empty record as null, so such a value would not read back as
 * itself, and `store_meta.generation` refuses an empty one too.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** What follows the store file's name in its side record's name. */
export const STORE_GENERATION_SUFFIX = '.generation';

/** The side record's path for the store file at `storePath`: the same path with `.generation` appended. */
export function storeGenerationPath(storePath: string): string {
  return `${storePath}${STORE_GENERATION_SUFFIX}`;
}

/** Whether `error` is the filesystem's "no such file" error. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The generation in the side record of the store file at `storePath`,
 * trimmed, or null when the record is absent or empty. Throws the
 * filesystem's error for any other failure to read it.
 */
export function readStoreGeneration(storePath: string): string | null {
  let text: string;
  try {
    text = readFileSync(storeGenerationPath(storePath), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  const generation = text.trim();
  return generation === ''
    ? null
    : generation;
}

/** Throws when `generation` would not read back as itself; see the module note. */
function assertWritableGeneration(generation: string): void {
  if (generation === '' || generation !== generation.trim() || /[\r\n]/.test(generation)) {
    throw new Error(`store generation must be non-empty, unpadded and on one line, got ${JSON.stringify(generation)}`);
  }
}

/**
 * Writes `generation` to the side record of the store file at
 * `storePath` through a temporary file and a rename. Throws, with the
 * temporary file removed, when the generation is refused or the write
 * or rename fails.
 */
export function writeStoreGeneration(storePath: string, generation: string): void {
  assertWritableGeneration(generation);
  const file = storeGenerationPath(storePath);
  const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${generation}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
