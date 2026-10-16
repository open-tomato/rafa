/**
 * Where a rafa command stands: its PROJECT scope, found by walking up
 * from a directory to the first one holding any of the three lookup
 * names {@link CONFIG_LOOKUP} lists, and its USER scope under the home
 * directory. These are the two scopes of
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
 * ## The three names
 *
 * A directory is a project root when it holds any of the names
 * `loadConfig` looks a project scope up by, in its order:
 * `rafa.config.ts`, then `rafa.config.mjs`, then `.rafa/config.yaml`
 * ({@link CONFIG_LOOKUP}). The walk probes the three in that order in
 * each directory, nearest directory first, and stops at the first
 * directory holding any one of them; the project scope's
 * {@link Scope.configFile} names the first of the three found there,
 * the file `loadConfig` reads for that scope when it is a file. A
 * directory holding only `rafa.config.ts` is therefore a project as
 * much as one holding only the YAML file, and a nearer directory
 * holding either wins over a farther one holding the other.
 *
 * A directory holds a name when `existsSync` finds anything at it. A
 * directory planted at `.rafa/config.yaml` is therefore found, and
 * `loadConfig` then refuses it by name. A stricter "is a regular file"
 * test would walk past it to whatever project sits above and run on
 * that project's settings without a word.
 *
 * ## The home is not a project
 *
 * The user scope's config under `~/.rafa/` sits exactly where the walk
 * looks once it reaches the home directory, and a walk from anywhere
 * under the home reaches it. Read as a project file it would make the
 * home the project root, a root `rafa init` refuses, and a command run
 * in any directory under the home without a project of its own would
 * run there. So the walk passes over the home directory, compared by
 * real path, and goes on above it, whichever of the three names the
 * home holds. When the home it passed over holds one, the hint names
 * the first of them as marking no project, since it is the file an
 * operator finds when they look.
 *
 * Comparing real paths matches a home spelled through a link, and a
 * home spelled in another case: measured on bun 1.3.14 on macOS,
 * `realpathSync('/users')` answers `/Users`.
 *
 * ## A linked worktree
 *
 * `.rafa/` is gitignored, so a linked worktree of a project's
 * repository holds none of its own, and a walk from a worktree beside
 * the main checkout reaches no project of its own. Worse, it may reach
 * someone else's: a worktree beside the main checkout under a parent
 * folder that holds its own `.rafa/config.yaml` would climb straight
 * past the repository into the parent's project. A parent holding
 * `rafa.config.ts` alone is the same trap.
 *
 * So the walk STOPS at the top level of the git working tree holding
 * the start: the first directory, climbing, whose {@link GIT_MARKER}
 * exists, a directory in a main checkout and a file in a linked
 * worktree, which is how git itself finds a working tree when no
 * `GIT_DIR` names one. It probes the config before the marker, so a
 * top level holding both answers itself. When the walk found nothing up
 * to there, or found nothing up to the filesystem root because no
 * directory holds the marker, the resolution asks for the MAIN CHECKOUT
 * of the repository holding the start, `mainCheckoutOf` in
 * `worktree-root.ts`, and answers it as the root when it holds any of
 * the three names, probed in the walk's order. Only when it does not does the walk go on above
 * the top level to the filesystem root, so a repository inside a
 * project, such as a checkout under a project's folder with no config
 * of its own, still runs in that project.
 *
 * The fallback runs only once the walk below the top level has found
 * nothing, so a start inside a project whose root is at or below its
 * working tree's top level never runs git, and a worktree whose own
 * `.rafa/` holds the file still resolves to itself. A worktree under
 * the main checkout, at `.rafa/worktrees/<name>` say, stops at its own
 * top level and runs git once, answering the main checkout the walk
 * would have climbed to. The fallback checks the main checkout alone and
 * does not climb above it: what is above it is the walk's to climb.
 * The main checkout is not probed when it is the start or a directory
 * above it, which the walk climbs whether or not it stops at the top
 * level, and it is not taken when it is the home, for the reason the
 * home is passed over. When the main checkout it probed holds none of
 * the three either, the hint names it.
 *
 * Git answers the main checkout as a real path, measured in
 * `worktree-root.ts`, so it compares with the real paths the walk
 * climbs. A git that cannot answer, a `WorktreeRootError`, is refused
 * as a {@link ScopeError} carrying it as its cause, so the dispatcher
 * prints it as it prints the walk's other refusals rather than
 * answering "no project" for a start it could not read.
 *
 * ## Seams
 *
 * The home is an argument with no default, as it is for `loadConfig`,
 * so a caller that leaves it out fails loudly rather than resolving the
 * operator's home: measured on bun 1.3.14, `isAbsolute(undefined)`
 * throws a `TypeError`. The filesystem is a {@link ScopeFileSystem},
 * the two calls the walk makes, and defaults to the disk. A test hands
 * in one of its own to walk to `/` without its answer depending on what
 * the machine's directories above its temporary root hold. The main
 * checkout is read through `mainCheckout`, `mainCheckoutOf` when left
 * out, so a test over an in-memory tree hands in its own rather than
 * running git in directories that are not on disk.
 *
 * The start and the home are refused with a {@link ScopeError} unless
 * each is an absolute path, because resolving a relative one would read
 * the process's working directory, a seam this module does not take. A
 * start that does not resolve is refused too, with nothing to climb
 * from. A home that does not resolve is not refused: nothing can sit
 * under it, so it is no directory the walk climbs.
 */
import type { ProjectFound, Scope } from '@open-tomato/rafa/core/config';

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { CONFIG_FILE, SCOPE_DIR, scopeAt } from '@open-tomato/rafa/core/config';
import { describeValue, messageOf } from '@open-tomato/rafa/core/config/sections';
import { RafaError } from '@open-tomato/rafa/errors/rafa-error';

import { mainCheckoutOf, WorktreeRootError } from './worktree-root.js';

/**
 * The directory a scope keeps its files in: `.rafa`. Declared beside
 * `CONFIG_FILE` in the core config module and re-exported here under
 * the same name, so this module's importers read the same binding.
 */
export { SCOPE_DIR };

/**
 * One scope's paths, the project the walk found, and the scope built
 * from a base directory. Declared in the core config module, so core
 * can name a project without importing this file, and re-exported here
 * under the same names, so this module's importers read the same
 * bindings.
 */
export type { ProjectFound, Scope };
export { scopeAt };

/**
 * The names a directory is probed for, in `loadConfig`'s lookup order
 * for a project scope: the two module files at the directory, then the
 * YAML file under its `.rafa/`. The last is `CONFIG_FILE`, so the two
 * cannot name different YAML files; the module names are spelled again
 * in `config-load.ts`, and `scope.test.ts` holds the two lists to one
 * answer by driving `loadConfig` over a root holding each name alone.
 */
const CONFIG_LOOKUP: readonly string[] = Object.freeze(['rafa.config.ts', 'rafa.config.mjs', CONFIG_FILE]);

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
  /**
   * The main checkout of the repository holding a directory, a real
   * path, or null outside any repository. `mainCheckoutOf` when absent.
   */
  readonly mainCheckout?: (dir: string) => string | null;
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

/** What a {@link ScopeError} is built from: its cause code, its message unprefixed, and its cause. */
export interface ScopeErrorOptions {
  /** The cause code, `<family>:<leaf>`, as `RafaError` takes it. */
  readonly code: string;
  /** The error line, without the `rafa scope: ` prefix the class adds. */
  readonly message: string;
  /** The error this one is reported for, as `ErrorOptions.cause`. */
  readonly cause?: unknown;
}

/**
 * A start or a home the walk cannot begin from: a relative path, or a
 * start that does not resolve.
 *
 * Its own class so a caller can tell a refusal it should print from a
 * fault it should not swallow. "No project" is not one: that is the
 * {@link NoProject} answer.
 *
 * A coded `RafaError` of the `project` module. Its three throw sites
 * code it: a relative start or home `input:invalid-value`, a start that
 * does not resolve `fs:not-found`, and a git that cannot name the main
 * checkout `git:new-context`, a code rafa's list holds no entry for
 * yet, so it carries no hint.
 */
export class ScopeError extends RafaError {
  static readonly module = 'project';

  /**
   * Builds the refusal from its cause code and message, the message
   * prefixed `rafa scope: `, and the error it is reported for when
   * there is one. `RafaError` names it `ScopeError`, after the class.
   */
  constructor(options: ScopeErrorOptions) {
    const { message, ...rest } = options;
    super({ ...rest, message: `rafa scope: ${message}` });
  }
}

/** The first of {@link CONFIG_LOOKUP} under `dir` that `fs` finds, or null. */
function lookupIn(dir: string, fs: ScopeFileSystem): string | null {
  for (const name of CONFIG_LOOKUP) {
    const path = join(dir, name);
    if (fs.exists(path)) return path;
  }
  return null;
}

/**
 * The hint printed outside a project: the directory the walk started
 * from, the three names no directory at or above it holds, and
 * `rafa init`. When the walk passed over a home holding one of them,
 * the first it found there is named as marking no project; and when the
 * fallback probed a main checkout holding none either, that checkout is
 * named. See the module note.
 */
export function initHint(
  start: string,
  passedUserConfig: string | null = null,
  probedMainCheckout: string | null = null,
): string {
  const passed = passedUserConfig === null
    ? []
    : [`${passedUserConfig} is in the home directory, and the home marks no project`];
  const main = probedMainCheckout === null
    ? []
    : [`nor in ${probedMainCheckout}, the main checkout of the repository holding it`];
  return [
    `not inside a rafa project: no ${lookupNames()} in ${start} or any directory above it`,
    ...main,
    ...passed,
    `run \`${INIT_COMMAND}\` to set one up`,
  ].join('\n');
}

/** {@link CONFIG_LOOKUP} as one phrase: `a, b or c`. */
function lookupNames(): string {
  const last = CONFIG_LOOKUP.at(-1) ?? CONFIG_FILE;
  return `${CONFIG_LOOKUP.slice(0, -1).join(', ')} or ${last}`;
}

/** Refuses a path that is not absolute; see the module note. */
function requireAbsolute(label: string, path: string): void {
  if (!isAbsolute(path)) {
    const message = `${label} is ${describeValue(path)}, expected an absolute path`;
    throw new ScopeError({ code: 'input:invalid-value', message });
  }
}

/** The start's real path, or a {@link ScopeError} naming it when it does not resolve. */
function realStartOf(start: string, fs: ScopeFileSystem): string {
  try {
    return fs.realpath(start);
  } catch (error) {
    const message = `start directory ${start} does not resolve (${messageOf(error)})`;
    throw new ScopeError({ code: 'fs:not-found', message, cause: error });
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

/** The marker git finds a working tree's top level by: a directory in a main checkout, a file in a linked worktree. */
const GIT_MARKER = '.git';

/**
 * Where one stretch of the walk stopped: the root it found with the
 * lookup name found there, the first lookup name of a home it passed
 * over, and the working tree's top level it stopped at, when it
 * stopped at one.
 */
interface Walk {
  readonly root: string | null;
  readonly file: string | null;
  readonly passedHomeFile: string | null;
  readonly topLevel: string | null;
}

/**
 * Climbs `dirs`, nearest first, to the first directory other than the
 * home holding any of {@link CONFIG_LOOKUP}. With `stopAtTopLevel`, a
 * directory holding none but holding {@link GIT_MARKER} ends the climb;
 * see the module note.
 */
function walkUp(
  dirs: readonly string[],
  realHome: string | null,
  fs: ScopeFileSystem,
  stopAtTopLevel: boolean,
): Walk {
  let passedHomeFile: string | null = null;
  for (const dir of dirs) {
    const file = lookupIn(dir, fs);
    if (file !== null) {
      if (dir !== realHome) return { root: dir, file, passedHomeFile, topLevel: null };
      passedHomeFile = file;
    }
    if (stopAtTopLevel && fs.exists(join(dir, GIT_MARKER))) {
      return { root: null, file: null, passedHomeFile, topLevel: dir };
    }
  }
  return { root: null, file: null, passedHomeFile, topLevel: null };
}

/** The main checkout of the repository holding `realStart`, a refusal wrapped as a {@link ScopeError}. */
function mainCheckoutAt(realStart: string, mainCheckout: (dir: string) => string | null): string | null {
  try {
    return mainCheckout(realStart);
  } catch (error) {
    if (!(error instanceof WorktreeRootError)) throw error;
    const message = `cannot read the main checkout of ${realStart} (${error.message})`;
    throw new ScopeError({ code: 'git:new-context', message, cause: error });
  }
}

/**
 * What the fallback found: the main checkout as the root with the
 * lookup name found there, or the one it probed in vain.
 */
interface Fallback {
  readonly root: string | null;
  readonly file: string | null;
  readonly probed: string | null;
}

/**
 * The main checkout as the root when the walk from `realStart` found
 * none and the checkout holds any of {@link CONFIG_LOOKUP}, probed in
 * order; see the module note. Probes
 * nothing when the checkout is null, the home, or a directory at or
 * above the start, which the walk probes whether or not it stops at
 * the top level.
 */
function fallBack(
  realStart: string,
  realHome: string | null,
  fs: ScopeFileSystem,
  mainCheckout: (dir: string) => string | null,
): Fallback {
  const main = mainCheckoutAt(realStart, mainCheckout);
  if (main === null || main === realHome || selfAndAncestors(realStart).includes(main)) {
    return { root: null, file: null, probed: null };
  }
  const file = lookupIn(main, fs);
  return file === null
    ? { root: null, file: null, probed: main }
    : { root: main, file, probed: main };
}

/**
 * The walk above the working tree's top level `lower` stopped at, or
 * nothing to climb when it stopped at none.
 */
function walkAbove(lower: Walk, realHome: string | null, fs: ScopeFileSystem): Walk {
  if (lower.topLevel === null) return lower;
  const above = selfAndAncestors(lower.topLevel).slice(1);
  const upper = walkUp(above, realHome, fs, false);
  return { ...upper, passedHomeFile: lower.passedHomeFile ?? upper.passedHomeFile };
}

/**
 * `path`, found under the real home `realHome`, spelled under the home
 * as the caller gave it, so the hint names the file where the operator
 * looks for it.
 */
function homeSpelled(path: string, realHome: string | null, home: string): string {
  return realHome === null
    ? path
    : join(home, relative(realHome, path));
}

/**
 * Resolves the scopes a command run in `start` stands in: the project
 * whose root is the nearest directory at or above `start` holding any
 * of {@link CONFIG_LOOKUP}, the home passed over, and the user scope
 * under `seams.home`. The project scope's `configFile` names the first
 * of the three its root holds. The walk stops at the top level of the
 * git working tree holding `start`; when it found none up to there, the
 * main checkout of the repository holding `start` is the root if it
 * holds any of the three,
 * and only then does the walk go on above the top level to the
 * filesystem root. Answers {@link NoProject}, carrying the `rafa init`
 * hint, when nothing holds any of them.
 *
 * Throws a {@link ScopeError} for a relative start or home, for a
 * start that does not resolve, and for a git that cannot say which
 * main checkout holds the start. See the module note for the walk and
 * the seams.
 */
export function resolveScope(start: string, seams: ScopeSeams): ScopeResolution {
  const { home, fs = DISK_FILE_SYSTEM, mainCheckout = mainCheckoutOf } = seams;
  requireAbsolute('start directory', start);
  requireAbsolute('home directory', home);

  const user = scopeAt(home);
  const realStart = realStartOf(start, fs);
  const realHome = realHomeOf(home, fs);
  const lower = walkUp(selfAndAncestors(realStart), realHome, fs, true);
  const fallback = lower.root === null
    ? fallBack(realStart, realHome, fs, mainCheckout)
    : { root: lower.root, file: lower.file, probed: null };
  const walk = fallback.root === null
    ? walkAbove(lower, realHome, fs)
    : lower;
  const root = fallback.root ?? walk.root;
  const file = fallback.file ?? walk.file;
  if (root === null || file === null) {
    const passed = walk.passedHomeFile === null
      ? null
      : homeSpelled(walk.passedHomeFile, realHome, home);
    return { found: false, start, home, user, hint: initHint(start, passed, fallback.probed) };
  }
  return { found: true, root, home, project: scopeAt(root, file), user };
}
