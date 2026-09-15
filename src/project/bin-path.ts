/**
 * Whether `~/.rafa/bin` comes ahead of `~/.bun/bin` on a `PATH`: the
 * check `rafa init` and `rafa doctor` warn by, from "Ports" in
 * `.specs/phase-1-installable.md`. The spec moves rafa's snapshot bin
 * out of bun's global bin directory into `~/.rafa/bin`, and a `rafa` in
 * `~/.bun/bin` found first on the `PATH` would run instead of it: on
 * 2026-09-14 `bun link` overwrote `~/.bun/bin/rafa` with no message.
 *
 * {@link readBinPath} reads a `PATH` value and a home directory and
 * answers where each directory sits on it and the warning to print, or
 * null. It reads the `PATH` it is handed and never a shell profile, so a
 * command hands it the environment its context carries. This module
 * prints nothing.
 *
 * ## The three states
 *
 *   - `ahead`: `~/.rafa/bin` is on the `PATH`, and `~/.bun/bin` is not
 *     or comes after it. No warning.
 *   - `missing`: `~/.rafa/bin` is not on the `PATH`, whatever
 *     `~/.bun/bin` does.
 *   - `behind`: both are on the `PATH`, `~/.bun/bin` first.
 *
 * Each directory's place is its first entry on the `PATH`, since a shell
 * searches the entries in order and stops at the first `rafa` it finds.
 *
 * ## Comparing an entry
 *
 * The `PATH` is split on the platform's delimiter, and an entry's index
 * is its place in that split, empty entries counted, so it names the
 * entry as the variable spells it. An entry that is not an absolute
 * path matches neither directory: an empty one, `.` or `bin` names a
 * directory relative to wherever a shell stands, and `~/.rafa/bin` is a
 * literal `~` to `execvp`, which does not expand it.
 *
 * An absolute entry and each directory are compared as real paths, every
 * symlink followed, and a path that does not resolve is compared as
 * `resolve` spells it, so a trailing slash or a `..` does not tell two
 * spellings apart. `~/.rafa/bin` usually does not exist before a
 * snapshot writes it, and is then compared as spelled. On macOS the
 * temporary directory is spelled through a link, `/var` for
 * `/private/var` (`scope.ts`), so a home under it matches an entry
 * spelled either way once the directory exists.
 *
 * ## Seams
 *
 * The home is an argument, as for `loadConfig`: a caller passes
 * `homedir()` and a test a directory of its own. The real path is read
 * through a {@link ScopeFileSystem}'s `realpath`, the disk by default.
 */
import type { ScopeFileSystem } from './scope.js';

import { delimiter, isAbsolute, join, resolve } from 'node:path';

import { DISK_FILE_SYSTEM, SCOPE_DIR } from './scope.js';

/** Where rafa's bin sits under the home: `.rafa/bin`. */
export const RAFA_BIN_DIR = join(SCOPE_DIR, 'bin');

/** Where bun's global bin sits under the home: `.bun/bin`. */
export const BUN_BIN_DIR = join('.bun', 'bin');

/** Where `~/.rafa/bin` sits on the `PATH`; see the module note. */
export type BinPathState = 'ahead' | 'missing' | 'behind';

/** What {@link readBinPath} answers. */
export interface BinPathReading {
  /** `<home>/.rafa/bin`. */
  readonly rafaBin: string;
  /** `<home>/.bun/bin`. */
  readonly bunBin: string;
  /** The index of the first `PATH` entry naming `rafaBin`, or null when none does. */
  readonly rafaIndex: number | null;
  /** The index of the first `PATH` entry naming `bunBin`, or null when none does. */
  readonly bunIndex: number | null;
  readonly state: BinPathState;
  /** The sentence to warn with, or null in the `ahead` state. */
  readonly warning: string | null;
}

/** The line that puts `rafaBin` first, for a warning to end with. */
function exportLine(rafaBin: string): string {
  return `export PATH="${rafaBin}:$PATH"`;
}

/** The warning for a state, or null when there is nothing to warn about. */
export function binPathWarning(state: BinPathState, rafaBin: string, bunBin: string): string | null {
  if (state === 'missing') {
    return `${rafaBin} is not on PATH; put it ahead of ${bunBin}, so a rafa there runs before one`
      + ` in ${bunBin}: ${exportLine(rafaBin)}`;
  }
  if (state === 'behind') {
    return `${rafaBin} is on PATH after ${bunBin}, so a rafa in ${bunBin} runs first; put it ahead:`
      + ` ${exportLine(rafaBin)}`;
  }
  return null;
}

/** `path` with every symlink followed, or as `resolve` spells it when it does not resolve. */
function canonical(path: string, fs: Pick<ScopeFileSystem, 'realpath'>): string {
  try {
    return fs.realpath(path);
  } catch {
    return resolve(path);
  }
}

/** The index of the first absolute entry naming `dir`, or null. */
function indexOf(entries: readonly string[], dir: string, fs: Pick<ScopeFileSystem, 'realpath'>): number | null {
  const target = canonical(dir, fs);
  const index = entries.findIndex((entry) => isAbsolute(entry) && canonical(entry, fs) === target);
  return index === -1
    ? null
    : index;
}

/** The state two indices put `~/.rafa/bin` in; see the module note. */
function stateOf(rafaIndex: number | null, bunIndex: number | null): BinPathState {
  if (rafaIndex === null) return 'missing';
  if (bunIndex !== null && bunIndex < rafaIndex) return 'behind';
  return 'ahead';
}

/**
 * Where `<home>/.rafa/bin` and `<home>/.bun/bin` sit on `pathValue`, a
 * `PATH` as the environment holds it, and the warning to print. An
 * absent `PATH` holds neither. See the module note for the comparison.
 */
export function readBinPath(
  pathValue: string | undefined,
  home: string,
  fs: Pick<ScopeFileSystem, 'realpath'> = DISK_FILE_SYSTEM,
): BinPathReading {
  const rafaBin = join(home, RAFA_BIN_DIR);
  const bunBin = join(home, BUN_BIN_DIR);
  const entries = (pathValue ?? '').split(delimiter);
  const rafaIndex = indexOf(entries, rafaBin, fs);
  const bunIndex = indexOf(entries, bunBin, fs);
  const state = stateOf(rafaIndex, bunIndex);
  return { rafaBin, bunBin, rafaIndex, bunIndex, state, warning: binPathWarning(state, rafaBin, bunBin) };
}
