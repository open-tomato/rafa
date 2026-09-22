/**
 * Where a saved copy of an issue goes when it is rebuilt: the
 * `previous/` directory under `specs.dir`, the name a copy is kept
 * under there, the move that puts it there without ever overwriting
 * another, and the count of copies `rafa doctor` warns about.
 *
 * `plan create --issue=<n>` plans from the saved copy
 * `<specs.dir>/rafa-<n>-<slug>.md`, and a plan made from it has to stay
 * traceable to the text it was made from. So a rebuild of that copy —
 * the notes-only one, a yes to the question, `--refresh` — first moves
 * the old text here rather than writing over it:
 *
 * ```text
 * saved copy     <specs.dir>/rafa-20-pr-commands.md
 * previous copy  <specs.dir>/previous/rafa-20-pr-commands.20260922T101500Z.md
 * name taken     <specs.dir>/previous/rafa-20-pr-commands.20260922T101500Z-2.md
 * ```
 *
 * ## The timestamp
 *
 * The saved copy's MODIFICATION time, as `YYYYMMDDTHHMMSSZ` in UTC, and
 * not the time of the move: a saved copy is never rewritten while it
 * matches the issue, so its mtime is when its text was taken, which is
 * the date a person tracing a plan back is looking for. The compact
 * form has no `:` in it, so the name is legal on every filesystem, and
 * it sorts in time order within one issue. Seconds are the grain; the
 * milliseconds are dropped, which is what the suffix below is for.
 *
 * ## Never overwritten
 *
 * Two rebuilds can read the same mtime to the second — a copy written
 * and rebuilt within one second, or two copies whose mtimes were set
 * alike by a checkout or a restore. The second one's name is taken, so
 * it gets `-2` before `.md`, then `-3`, and so on until a name is free.
 *
 * The move is a hard link followed by removing the saved copy, not a
 * rename: `rename(2)` replaces a destination that exists, silently,
 * while `link(2)` refuses one with `EEXIST`. Checking for the name first
 * and renaming after would leave a window in which a second run takes
 * the same name and one of the two copies is lost; the link makes
 * "is the name free" and "take it" one step. `previous/` sits under
 * `specs.dir`, beside the saved copy, so the two are on one filesystem
 * and the link is always possible there.
 *
 * ## The count
 *
 * {@link countPreviousCopies} counts the `.md` files directly under
 * `previous/`, which is what `rafa doctor` reports and warns about once
 * it passes {@link PREVIOUS_COPY_WARN_ABOVE}. The copies are small and
 * `.rafa/` is gitignored whole, so nothing else ever removes them; the
 * warning is how a person learns they are there to delete. A missing
 * `previous/` counts zero, since no rebuild has happened yet.
 *
 * The filesystem is reached only under the `repoRoot` a caller names,
 * so every case in `./previous-copy.test.ts` writes in its own temporary
 * directory.
 */
import { linkSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import { messageOf } from '../config-sections.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board previous copy';

/** The directory under `specs.dir` previous copies are kept in. */
export const PREVIOUS_DIR_NAME = 'previous';

/** The count of previous copies above which `rafa doctor` warns; fifty is quiet, fifty-one warns. */
export const PREVIOUS_COPY_WARN_ABOVE = 50;

/** The extension a saved copy and every previous copy carry. */
const COPY_EXTENSION = '.md';

/** The first suffix a taken name gets; the unsuffixed name is the first attempt. */
const FIRST_SUFFIX = 2;

/**
 * Where previous copies live: `previous/` under `specsDir`, as
 * `specs.dir` resolved it.
 */
export function previousDir(specsDir: string): string {
  return join(specsDir, PREVIOUS_DIR_NAME);
}

/** Pads a date field to two digits. */
function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `mtime` as `YYYYMMDDTHHMMSSZ` in UTC, to the second:
 * `2026-09-22T10:15:00.750Z` answers `20260922T101500Z`.
 */
export function previousTimestamp(mtime: Date): string {
  const date = `${String(mtime.getUTCFullYear()).padStart(4, '0')}${two(mtime.getUTCMonth() + 1)}${two(mtime.getUTCDate())}`;
  const time = `${two(mtime.getUTCHours())}${two(mtime.getUTCMinutes())}${two(mtime.getUTCSeconds())}`;
  return `${date}T${time}Z`;
}

/**
 * The name a saved copy called `savedName` is kept under in `previous/`
 * on its `attempt`-th try: the name without `.md`, the timestamp, then
 * `.md` on the first attempt and `-<attempt>.md` from the second on.
 */
export function previousCopyName(savedName: string, timestamp: string, attempt: number): string {
  const stem = basename(savedName, extname(savedName));
  const suffix = attempt < FIRST_SUFFIX
    ? ''
    : `-${String(attempt)}`;
  return `${stem}.${timestamp}${suffix}${COPY_EXTENSION}`;
}

/** What {@link movePreviousCopy} is asked. */
export interface PreviousCopyOptions {
  /** The project root the paths are resolved against. */
  readonly repoRoot: string;
  /** Where saved copies live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** The saved copy to move, under `specsDir` as configured. */
  readonly path: string;
}

/** Where a saved copy was moved to. */
export interface PreviousCopy {
  /** The previous copy under `specs.dir` as configured, as a message names it. */
  readonly path: string;
  /** The same file, resolved against the project root. */
  readonly absolute: string;
}

/** True when `error` is the `EEXIST` a link onto a taken name raises. */
function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

/**
 * Links `source` under the first free name in `directory` and answers
 * that name; never replaces a file already there.
 */
function linkUnderFreeName(source: string, directory: string, savedName: string, timestamp: string): string {
  for (let attempt = 1; ; attempt += 1) {
    const name = previousCopyName(savedName, timestamp, attempt);
    try {
      linkSync(source, join(directory, name));
      return name;
    } catch (error) {
      if (!isTaken(error)) throw error;
    }
  }
}

/**
 * Moves the saved copy at `options.path` to `previous/` under
 * `options.specsDir`, named by its mtime ({@link previousTimestamp}) and
 * suffixed until the name is free, and answers where it went.
 *
 * Throws an `Error` naming the saved copy when it cannot be read, or
 * the move cannot be made; a saved copy that was linked but could not be
 * removed is named too, since both files then hold the text.
 */
export function movePreviousCopy(options: PreviousCopyOptions): PreviousCopy {
  const { repoRoot, specsDir, path } = options;
  const source = resolve(repoRoot, path);
  const directory = previousDir(specsDir);
  const absoluteDirectory = resolve(repoRoot, directory);
  const savedName = basename(path);

  let name: string;
  try {
    const timestamp = previousTimestamp(statSync(source).mtime);
    mkdirSync(absoluteDirectory, { recursive: true });
    name = linkUnderFreeName(source, absoluteDirectory, savedName, timestamp);
  } catch (error) {
    throw new Error(`${PREFIX}: ${path} could not be moved to ${directory}: ${messageOf(error)}`, { cause: error });
  }

  const moved: PreviousCopy = {
    path: join(directory, name),
    absolute: join(absoluteDirectory, name),
  };
  try {
    unlinkSync(source);
  } catch (error) {
    throw new Error(`${PREFIX}: ${path} was copied to ${moved.path} but could not be removed: ${messageOf(error)}`, { cause: error });
  }
  return moved;
}

/** True when `error` is the `ENOENT` a missing directory raises. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * How many previous copies `previous/` under `specsDir` holds: the
 * `.md` files directly in it, not in a directory below it. A missing
 * `previous/` counts zero; any other failure to read it throws.
 */
export function countPreviousCopies(repoRoot: string, specsDir: string): number {
  const directory = previousDir(specsDir);
  try {
    return readdirSync(resolve(repoRoot, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(COPY_EXTENSION))
      .length;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw new Error(`${PREFIX}: ${directory} could not be read: ${messageOf(error)}`, { cause: error });
  }
}
