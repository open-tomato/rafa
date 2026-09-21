/**
 * Where a rafa command stands: its PROJECT scope, found by walking up
 * from a directory to the first one holding `.rafa/config.yaml`, and
 * its USER scope under the home directory. These are the two scopes of
 * "Scope resolution" in `.rafa/specs/phase-1-installable.md`.
 *
 * {@link resolveScope} answers one of two shapes. Inside a project it
 * answers the project root and both scopes' paths, and that answer is
 * itself the `ConfigRoots` that `loadConfig` reads (`config-load.ts`).
 * Outside a project it answers the text of the `rafa init` hint, for
 * the caller to print before it exits nonzero. This module prints
 * nothing and exits nothing: which commands need a project is the
 * dispatcher's decision.
 *
 * ## The walk
 *
 * The walk begins at the start directory's REAL path, every symlink
 * followed, and climbs one `dirname` at a time to the filesystem root.
 * No directory above a real path is a link, so the walk climbs the
 * directories the files sit in rather than the path the start was
 * spelled through: a start reached through a link climbs its target's
 * parents, and the root answered is a real path. On macOS every
 * temporary directory is spelled through a link — measured on bun
 * 1.3.14, `tmpdir()` answers `/var/folders/...`, whose real path is
 * `/private/var/folders/...` — so a caller compares the answered root
 * with a real path.
 *
 * A directory holds the file when `existsSync` finds anything at its
 * `.rafa/config.yaml`, the test `loadConfig` reads the file by. A
 * directory planted at that path is therefore found, and `loadConfig`
 * then refuses it by name. A stricter "is a regular file" test would
 * walk past it to whatever project sits above and run on that
 * project's settings without a word.
 *
 * ## The home is not a project
 *
 * The user scope's `~/.rafa/config.yaml` sits exactly where the walk
 * looks once it reaches the home directory, and a walk from anywhere
 * under the home reaches it. Read as a project file it would make the
 * home the project root, a root `rafa init` refuses, and a command run
 * in any directory under the home without a project of its own would
 * run there. So the walk passes over the home directory, compared by
 * real path, and goes on above it. When the home it passed over holds
 * the user scope's file, the hint names that file as marking no
 * project, since it is the file an operator finds when they look.
 *
 * Comparing real paths matches a home spelled through a link, and a
 * home spelled in another case: measured on bun 1.3.14 on macOS,
 * `realpathSync('/users')` answers `/Users`.
 *
 * ## Seams
 *
 * The home is an argument with no default, as it is for `loadConfig`,
 * so a caller that leaves it out fails loudly rather than resolving the
 * operator's home: measured on bun 1.3.14, `isAbsolute(undefined)`
 * throws a `TypeError`. The filesystem is a {@link ScopeFileSystem},
 * the two calls the walk makes, and defaults to the disk. A test hands
 * in one of its own to walk to `/` without its answer depending on what
 * the machine's directories above its temporary root hold.
 *
 * The start and the home are refused with a {@link ScopeError} unless
 * each is an absolute path, because resolving a relative one would read
 * the process's working directory, a seam this module does not take. A
 * start that does not resolve is refused too, with nothing to climb
 * from. A home that does not resolve is not refused: nothing can sit
 * under it, so it is no directory the walk climbs.
 */
import type { ConfigRoots } from '../config-load.js';

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { describeValue, messageOf } from '../config-sections.js';
import { CONFIG_FILE, configFilePath } from '../config.js';

/**
 * The directory a scope keeps its files in, relative to the project
 * root or the home: `.rafa`. Taken from `CONFIG_FILE`, so the two
 * cannot name different directories.
 */
export const SCOPE_DIR = dirname(CONFIG_FILE);

/** The command the hint sends an operator to. */
export const INIT_COMMAND = 'rafa init';

/**
 * The filesystem calls the walk makes. {@link DISK_FILE_SYSTEM} answers
 * them from the disk; a test hands in its own.
 */
export interface ScopeFileSystem {
  /** True when anything is at `path`, symlinks followed, as `existsSync` answers. */
  readonly exists: (path: string) => boolean;
  /**
   * `path` with every symlink followed, as `realpathSync` answers.
   * Throws when the path does not resolve.
   */
  readonly realpath: (path: string) => string;
}

/** The {@link ScopeFileSystem} over the disk: `existsSync` and `realpathSync`. */
export const DISK_FILE_SYSTEM: ScopeFileSystem = Object.freeze({
  exists: (path: string) => existsSync(path),
  realpath: (path: string) => realpathSync(path),
});

/** What {@link resolveScope} reads beside the start directory. */
export interface ScopeSeams {
  /** The home directory, an absolute path. There is no default; see the module note. */
  readonly home: string;
  /** The filesystem the walk reads. {@link DISK_FILE_SYSTEM} when absent. */
  readonly fs?: ScopeFileSystem;
}

/** One scope's paths: its `.rafa` directory and the config file in it. */
export interface Scope {
  /** `<base>/.rafa`. */
  readonly dir: string;
  /** `<base>/.rafa/config.yaml`. */
  readonly configFile: string;
}

/**
 * The walk found a project. The answer is the `ConfigRoots` for
 * `loadConfig`: `root` is the project root, a real path, and `home` is
 * the home as the caller gave it.
 */
export interface ProjectFound extends ConfigRoots {
  readonly found: true;
  /** The project scope, under `root`. */
  readonly project: Scope;
  /** The user scope, under `home`. */
  readonly user: Scope;
}

/** The walk reached the filesystem root without finding a project. */
export interface NoProject {
  readonly found: false;
  /** The start directory, as the caller gave it. */
  readonly start: string;
  /** The home, as the caller gave it. */
  readonly home: string;
  /** The user scope, under `home`, which `rafa init` reads without a project. */
  readonly user: Scope;
  /** The `rafa init` hint, for the caller to print; see {@link initHint}. */
  readonly hint: string;
}

/** What {@link resolveScope} answers: a project found, or the hint. */
export type ScopeResolution = ProjectFound | NoProject;

/**
 * A start or a home the walk cannot begin from: a relative path, or a
 * start that does not resolve.
 *
 * Its own class so a caller can tell a refusal it should print from a
 * fault it should not swallow. "No project" is not one: that is the
 * {@link NoProject} answer.
 */
export class ScopeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`rafa scope: ${message}`, options);
    this.name = 'ScopeError';
  }
}

/** The scope under `base`: `base` is a project root or a home directory. */
export function scopeAt(base: string): Scope {
  return { dir: join(base, SCOPE_DIR), configFile: configFilePath(base) };
}

/**
 * The hint printed outside a project: the directory the walk started
 * from, the file no directory at or above it holds, and `rafa init`.
 * When the walk passed over a home holding the user scope's file, that
 * file is named as marking no project; see the module note.
 */
export function initHint(start: string, passedUserConfig: string | null = null): string {
  const passed = passedUserConfig === null
    ? []
    : [`${passedUserConfig} is the user scope's config and marks no project`];
  return [
    `not inside a rafa project: no ${CONFIG_FILE} in ${start} or any directory above it`,
    ...passed,
    `run \`${INIT_COMMAND}\` to set one up`,
  ].join('\n');
}

/** Refuses a path that is not absolute; see the module note. */
function requireAbsolute(label: string, path: string): void {
  if (!isAbsolute(path)) {
    throw new ScopeError(`${label} is ${describeValue(path)}, expected an absolute path`);
  }
}

/** The start's real path, or a {@link ScopeError} naming it when it does not resolve. */
function realStartOf(start: string, fs: ScopeFileSystem): string {
  try {
    return fs.realpath(start);
  } catch (error) {
    const message = `start directory ${start} does not resolve (${messageOf(error)})`;
    throw new ScopeError(message, { cause: error });
  }
}

/** The home's real path, or null when it does not resolve and so holds nothing. */
function realHomeOf(home: string, fs: ScopeFileSystem): string | null {
  try {
    return fs.realpath(home);
  } catch {
    return null;
  }
}

/**
 * `path` and every directory above it, nearest first, ending at the
 * filesystem root. Lexical: it reads nothing, so a caller hands in a
 * real path to climb real directories. `roots.ts` climbs with it too.
 */
export function selfAndAncestors(path: string): readonly string[] {
  const parent = dirname(path);
  return parent === path
    ? [path]
    : [path, ...selfAndAncestors(parent)];
}

/** Where the walk stopped, and whether it passed over a home holding the user file. */
interface Walk {
  readonly root: string | null;
  readonly passedUserConfig: boolean;
}

/** Climbs from `realStart` to the first directory other than the home holding the file. */
function walkUp(realStart: string, realHome: string | null, fs: ScopeFileSystem): Walk {
  let passedUserConfig = false;
  for (const dir of selfAndAncestors(realStart)) {
    if (!fs.exists(configFilePath(dir))) continue;
    if (dir !== realHome) return { root: dir, passedUserConfig };
    passedUserConfig = true;
  }
  return { root: null, passedUserConfig };
}

/**
 * Resolves the scopes a command run in `start` stands in: the project
 * whose root is the nearest directory at or above `start` holding
 * `.rafa/config.yaml`, the home passed over, and the user scope under
 * `seams.home`. Answers {@link NoProject}, carrying the `rafa init`
 * hint, when no directory up to the filesystem root holds the file.
 *
 * Throws a {@link ScopeError} for a relative start or home and for a
 * start that does not resolve. See the module note for the walk and
 * the seams.
 */
export function resolveScope(start: string, seams: ScopeSeams): ScopeResolution {
  const { home, fs = DISK_FILE_SYSTEM } = seams;
  requireAbsolute('start directory', start);
  requireAbsolute('home directory', home);

  const user = scopeAt(home);
  const walk = walkUp(realStartOf(start, fs), realHomeOf(home, fs), fs);
  if (walk.root === null) {
    const passed = walk.passedUserConfig
      ? user.configFile
      : null;
    return { found: false, start, home, user, hint: initHint(start, passed) };
  }
  return { found: true, root: walk.root, home, project: scopeAt(walk.root), user };
}
