/**
 * Where `rafa init` offers to put a project, and where it refuses to:
 * steps 1 to 3 of `rafa init` under "Scope resolution" in
 * `.specs/phase-1-installable.md`.
 *
 * {@link rootCandidates} answers one or two candidates for a start
 * directory, in the order `init` offers them:
 *
 * 1. The base: the git toplevel when the start sits in a git work
 *    tree, and the start itself when it does not.
 * 2. The monorepo root: the outermost directory at or above the base
 *    holding a monorepo marker, when that directory is not the base.
 *
 * Each candidate carries its {@link RootRefusal}, or null, so `init`
 * can show a refused candidate beside its reason rather than drop it
 * without a word. {@link rootRefusal} answers the same refusal for any
 * path, such as a root typed freely or named by `--root`. This module
 * prints nothing, asks nothing and writes nothing: presenting the
 * candidates and taking one is `init`'s.
 *
 * ## Refused roots
 *
 * `/`, `/var`, `/etc`, `/usr`, `/home` and `/Users` are refused by name
 * ({@link REFUSED_ROOTS}), the home directory because its `.rafa/` is
 * the user scope, and any path no project tree can be written under:
 * one that does not resolve, one that is not a directory, and one this
 * user may not write. The checks by name run first, so `/` is refused
 * as the filesystem root and not for its permission: measured on bun
 * 1.3.14 on macOS, `accessSync('/', W_OK)` throws `EROFS`.
 *
 * A refusal is for the path itself and never for a path under it.
 * Every temporary directory on macOS sits under `/var` and every
 * checkout under `/Users`, and a project may take either. Paths are
 * compared as real paths, every symlink followed, because refused
 * directories are spelled through links: measured on bun 1.3.14 on
 * macOS, `realpathSync` answers `/private/var` for `/var` and for
 * `/VAR`, `/private/etc` for `/etc` and `/System/Volumes/Data/home`
 * for `/home`. A refused directory or a home that does not resolve is
 * compared as spelled, and so is a given path that does not resolve.
 *
 * ## The monorepo walk
 *
 * A directory holds a monorepo marker when anything is at its
 * `turbo.json`, `pnpm-workspace.yaml`, `nx.json` or `lerna.json`, as
 * `existsSync` answers, or when its `package.json` parses to an object
 * with a `workspaces` key, whatever that key holds. A `package.json`
 * that cannot be read or does not parse marks nothing, and the answer
 * carries a warning naming it: a broken file above a project is no
 * reason to refuse `init`, and no reason to say nothing either.
 *
 * The walk climbs from the base's real path to the filesystem root and
 * takes the outermost directory holding a marker. It passes over every
 * directory refused by name, the home among them, whatever it holds. A
 * marker there names a root `init` refuses in any case, and taking it
 * as the outermost would hide the monorepo below it: a `package.json`
 * with `workspaces` in the home would stand in for every monorepo
 * checked out under it. A directory refused for its permission is not
 * passed over: whether it can be written is the machine's state, and a
 * candidate refused for it tells the operator what to change.
 *
 * The walk starts at the base and not at the start directory, so
 * inside a repository a marker between the start and the toplevel is
 * no marker.
 *
 * ## Git
 *
 * {@link gitToplevel} runs `git rev-parse --show-toplevel` in the
 * directory. It answers null only when git prints the line that says
 * no directory at or above holds a repository, {@link NOT_A_REPOSITORY}.
 * Measured with Apple Git 2.50.1, that line is `fatal: not a git
 * repository (or any of the parent directories): .git`, exit 128. Git
 * exits 128 for other fatal errors too: a `.git` file naming a
 * directory that does not exist prints `fatal: not a git repository:
 * <dir>`, exit 128. So any other failure, and a git that cannot run,
 * is a {@link RootsError} and never an answer of "no repository".
 *
 * The probe runs git with `LC_ALL=C` so the line it matches is git's
 * untranslated one. The git measured here printed the same line with
 * `LANGUAGE=de` as without it, so no reading here has seen a
 * translated line. Measured on bun 1.3.14, a `spawnSync` whose binary
 * or working directory is missing answers an `error` and an
 * `undefined` status, not a null one, so the probe reads `error`
 * before the status.
 *
 * ## Seams
 *
 * As in `scope.ts`, the home is an argument with no default, and a
 * start, a home or a path to refuse that is not absolute is a
 * {@link RootsError}, since resolving it would read the process's
 * working directory. So is a start that does not resolve. The
 * filesystem is a {@link RootsFileSystem} and defaults to the disk; the
 * git probe is a {@link GitToplevelProbe} and defaults to
 * {@link gitToplevel}.
 */
import type { ScopeFileSystem } from './scope.js';

import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { describeValue, messageOf } from '../config-sections.js';

import { DISK_FILE_SYSTEM, SCOPE_DIR, selfAndAncestors } from './scope.js';

/** A directory refused by name, and why. */
export interface RefusedRoot {
  /** The path, as the spec spells it. */
  readonly path: string;
  /** Why, as a clause whose subject is the path: `holds system state`. */
  readonly why: string;
}

/** The directories refused by name, in the spec's order; see the module note. */
export const REFUSED_ROOTS: readonly RefusedRoot[] = Object.freeze([
  { path: '/', why: 'is the filesystem root' },
  { path: '/var', why: 'holds system state' },
  { path: '/etc', why: 'holds system configuration' },
  { path: '/usr', why: 'holds system programs' },
  { path: '/home', why: 'holds the home directories of every user' },
  { path: '/Users', why: 'holds the home directories of every user' },
]);

/** Why the home directory is refused, as a {@link RefusedRoot} `why`. */
export const HOME_WHY = `is the home directory, whose ${SCOPE_DIR}/ is the user scope`;

/** The marker files found by name alone. */
export const MONOREPO_MARKER_FILES = Object.freeze([
  'turbo.json',
  'pnpm-workspace.yaml',
  'nx.json',
  'lerna.json',
] as const);

/** The manifest that marks a monorepo when it has a `workspaces` key. */
export const PACKAGE_JSON = 'package.json';

/**
 * The start of the line `git rev-parse` prints when no directory at or
 * above holds a repository; see the module note.
 */
export const NOT_A_REPOSITORY = 'fatal: not a git repository (or any ';

/**
 * What a refusal is for: `system` for a directory in
 * {@link REFUSED_ROOTS}, `home` for the home directory, and
 * `unwritable` for a path no project tree can be written under.
 */
export type RefusalKind = 'system' | 'home' | 'unwritable';

/** A path refused as a project root, with its reason. */
export interface RootRefusal {
  readonly kind: RefusalKind;
  /** The path refused, as the caller gave it. */
  readonly path: string;
  /** A sentence naming the path and why it is refused, for `init` to print. */
  readonly reason: string;
}

/** Where a candidate comes from. */
export type CandidateSource = 'git-toplevel' | 'directory' | 'monorepo';

/** A root `init` offers. */
export interface RootCandidate {
  /** The root, a real path. */
  readonly path: string;
  readonly source: CandidateSource;
  /**
   * The monorepo markers at `path`, `package.json` first and the rest in
   * {@link MONOREPO_MARKER_FILES} order; empty when it holds none or is
   * refused by name.
   */
  readonly markers: readonly string[];
  /** Why `path` is refused, or null when a project may take it. */
  readonly refusal: RootRefusal | null;
}

/** What {@link rootCandidates} answers. */
export interface RootCandidates {
  /** The start directory, as the caller gave it. */
  readonly start: string;
  /** The base first, then the monorepo root when it is another directory. */
  readonly candidates: readonly [RootCandidate, ...RootCandidate[]];
  /** One line per `package.json` the walk could not read, for `init` to print. */
  readonly warnings: readonly string[];
}

/** The filesystem calls this module makes: the walk's two, and three more. */
export interface RootsFileSystem extends ScopeFileSystem {
  /** The text of the file at `path`, as `readFileSync` answers. Throws when it cannot be read. */
  readonly readFile: (path: string) => string;
  /** True when `path`, a path that resolves, is a directory. */
  readonly isDirectory: (path: string) => boolean;
  /** Returns when this user may write `path`, and throws, as `accessSync` does, when not. */
  readonly assertWritable: (path: string) => void;
}

/** The {@link RootsFileSystem} over the disk. */
export const DISK_ROOTS_FILE_SYSTEM: RootsFileSystem = Object.freeze({
  ...DISK_FILE_SYSTEM,
  readFile: (path: string) => readFileSync(path, 'utf8'),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  assertWritable: (path: string) => accessSync(path, constants.W_OK),
});

/**
 * The git toplevel above `dir`, a real path, or null when no repository
 * holds it. Throws for anything it cannot answer; see {@link gitToplevel}.
 */
export type GitToplevelProbe = (dir: string) => string | null;

/** What {@link rootRefusal} reads beside the path. */
export interface RefusalSeams {
  /** The home directory, an absolute path. There is no default. */
  readonly home: string;
  /** The filesystem read. {@link DISK_ROOTS_FILE_SYSTEM} when absent. */
  readonly fs?: RootsFileSystem;
}

/** What {@link rootCandidates} reads beside the start directory. */
export interface RootsSeams extends RefusalSeams {
  /** The git probe. {@link gitToplevel} when absent. */
  readonly gitToplevel?: GitToplevelProbe;
}

/**
 * A start, a home or a path this module cannot begin from, or a git
 * that cannot answer. A refused root is not one: that is a
 * {@link RootRefusal}.
 */
export class RootsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`rafa roots: ${message}`, options);
    this.name = 'RootsError';
  }
}

/**
 * Runs `git rev-parse --show-toplevel` in `dir` and answers the
 * toplevel it prints, or null when git says no repository holds `dir`.
 * Throws a {@link RootsError} when git cannot run or fails any other
 * way; see the module note.
 */
export function gitToplevel(dir: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error !== undefined) {
    throw new RootsError(`git could not run in ${dir} (${result.error.message})`, { cause: result.error });
  }
  if (result.status === 0) return result.stdout.replace(/\n$/, '');
  if (result.stderr.startsWith(NOT_A_REPOSITORY)) return null;
  const status = String(result.status);
  throw new RootsError(`git rev-parse --show-toplevel failed in ${dir}, exit ${status}: ${result.stderr.trim()}`);
}

/** Refuses a path that is not absolute; see the module note. */
function requireAbsolute(label: string, path: string): void {
  if (!isAbsolute(path)) {
    throw new RootsError(`${label} is ${describeValue(path)}, expected an absolute path`);
  }
}

/** `path`'s real path, or a {@link RootsError} naming it when it does not resolve. */
function realOf(label: string, path: string, fs: RootsFileSystem): string {
  try {
    return fs.realpath(path);
  } catch (error) {
    throw new RootsError(`${label} ${path} does not resolve (${messageOf(error)})`, { cause: error });
  }
}

/** `path`'s real path, or `path` normalized as spelled when it does not resolve. */
function realOrSpelled(path: string, fs: RootsFileSystem): string {
  try {
    return fs.realpath(path);
  } catch {
    return resolve(path);
  }
}

/** A directory refused by name, with the real path it is compared by. */
interface NamedRoot extends RefusedRoot {
  readonly kind: 'system' | 'home';
  readonly real: string;
}

/** Every directory refused by name, the home last. */
function namedRoots(home: string, fs: RootsFileSystem): readonly NamedRoot[] {
  const system = REFUSED_ROOTS.map(({ path, why }): NamedRoot => ({
    kind: 'system',
    path,
    why,
    real: realOrSpelled(path, fs),
  }));
  return [...system, { kind: 'home', path: home, why: HOME_WHY, real: realOrSpelled(home, fs) }];
}

/** The refusal by name for a path whose real path is `real`, or null. */
function namedRefusal(given: string, real: string, named: readonly NamedRoot[]): RootRefusal | null {
  const match = named.find((root) => root.real === real);
  if (match === undefined) return null;
  const reason = given === match.path
    ? `${given} ${match.why}`
    : `${given} is the same directory as ${match.path}, which ${match.why}`;
  return { kind: match.kind, path: given, reason };
}

/** A refusal for a path no project tree can be written under. */
function unwritable(given: string, why: string): RootRefusal {
  return { kind: 'unwritable', path: given, reason: `${given} ${why}` };
}

/** A path's real path, or what stopped it resolving. */
type Resolved =
  | { readonly real: string; readonly error: null }
  | { readonly real: null; readonly error: unknown };

/** Resolves `path` without throwing. */
function resolveReal(path: string, fs: RootsFileSystem): Resolved {
  try {
    return { real: fs.realpath(path), error: null };
  } catch (error) {
    return { real: null, error };
  }
}

/** The refusal for a real path that is not a directory or cannot be written, or null. */
function writeRefusal(given: string, real: string, fs: RootsFileSystem): RootRefusal | null {
  if (!fs.isDirectory(real)) {
    return unwritable(given, 'is not a directory, so no project tree can be written under it');
  }
  try {
    fs.assertWritable(real);
    return null;
  } catch (error) {
    return unwritable(given, `is not writable by this user (${messageOf(error)})`);
  }
}

/** The refusal for `given`: by name first, then for writing. */
function refusalOf(given: string, named: readonly NamedRoot[], fs: RootsFileSystem): RootRefusal | null {
  const resolved = resolveReal(given, fs);
  const byName = namedRefusal(given, resolved.real ?? resolve(given), named);
  if (byName !== null) return byName;
  if (resolved.real === null) {
    const detail = messageOf(resolved.error);
    return unwritable(given, `does not resolve, so no project tree can be written under it (${detail})`);
  }
  return writeRefusal(given, resolved.real, fs);
}

/**
 * Why `path` is refused as a project root, or null when a project may
 * take it: `/`, `/var`, `/etc`, `/usr`, `/home`, `/Users` and the home
 * directory by name, compared as real paths, and then any path that
 * does not resolve, is not a directory, or this user may not write.
 *
 * Throws a {@link RootsError} for a relative path or home. See the
 * module note for the order of the checks and the comparison.
 */
export function rootRefusal(path: string, seams: RefusalSeams): RootRefusal | null {
  const { home, fs = DISK_ROOTS_FILE_SYSTEM } = seams;
  requireAbsolute('root', path);
  requireAbsolute('home directory', home);
  return refusalOf(path, namedRoots(home, fs), fs);
}

/** A `package.json` read as a marker: whether it marks, and why it could not be read. */
interface ManifestReading {
  readonly marks: boolean;
  readonly warnings: readonly string[];
}

/** True when a parsed manifest is an object with a `workspaces` key. */
function hasWorkspaces(manifest: unknown): boolean {
  return typeof manifest === 'object'
    && manifest !== null
    && Object.hasOwn(manifest, 'workspaces');
}

/** Reads the `package.json` at `file` as a marker; see the module note. */
function readManifest(file: string, fs: RootsFileSystem): ManifestReading {
  if (!fs.exists(file)) return { marks: false, warnings: [] };
  try {
    return { marks: hasWorkspaces(JSON.parse(fs.readFile(file))), warnings: [] };
  } catch (error) {
    return { marks: false, warnings: [`${file} was not read as a monorepo marker (${messageOf(error)})`] };
  }
}

/** A directory the walk read, the markers it holds, and the warnings reading it raised. */
interface MarkedDir extends ManifestReading {
  readonly dir: string;
  readonly markers: readonly string[];
}

/** The markers `dir` holds. */
function readDir(dir: string, fs: RootsFileSystem): MarkedDir {
  const manifest = readManifest(join(dir, PACKAGE_JSON), fs);
  const files = MONOREPO_MARKER_FILES.filter((name) => fs.exists(join(dir, name)));
  const markers = manifest.marks
    ? [PACKAGE_JSON, ...files]
    : files;
  return { ...manifest, dir, markers };
}

/** Every directory from `base` to the filesystem root, those refused by name passed over. */
function walkMarkers(base: string, named: readonly NamedRoot[], fs: RootsFileSystem): readonly MarkedDir[] {
  return selfAndAncestors(base)
    .filter((dir) => !named.some((root) => root.real === dir))
    .map((dir) => readDir(dir, fs));
}

/** The candidate at `path`, a real path, with its markers from the walk and its refusal. */
function candidateAt(
  path: string,
  source: CandidateSource,
  walk: readonly MarkedDir[],
  named: readonly NamedRoot[],
  fs: RootsFileSystem,
): RootCandidate {
  const markers = walk.find((read) => read.dir === path)?.markers ?? [];
  return { path, source, markers, refusal: refusalOf(path, named, fs) };
}

/**
 * The root candidates `rafa init` offers for a start directory: the
 * git toplevel when the start is in a repository and the start's real
 * path when it is not, then the outermost directory at or above that
 * base holding a monorepo marker, when it is another directory. Each
 * candidate carries its refusal or null, and the answer carries a
 * warning for each `package.json` the walk could not read.
 *
 * Throws a {@link RootsError} for a relative start or home, a start
 * that does not resolve, a git probe answering a relative toplevel or
 * one that does not resolve, and whatever the git probe throws. See
 * the module note for the walk and the seams.
 */
export function rootCandidates(start: string, seams: RootsSeams): RootCandidates {
  const { home, fs = DISK_ROOTS_FILE_SYSTEM, gitToplevel: probe = gitToplevel } = seams;
  requireAbsolute('start directory', start);
  requireAbsolute('home directory', home);

  const realStart = realOf('start directory', start, fs);
  const toplevel = probe(realStart);
  if (toplevel !== null) requireAbsolute('git toplevel', toplevel);
  const base = toplevel === null
    ? realStart
    : realOf('git toplevel', toplevel, fs);
  const source: CandidateSource = toplevel === null
    ? 'directory'
    : 'git-toplevel';

  const named = namedRoots(home, fs);
  const walk = walkMarkers(base, named, fs);
  const outermost = walk.filter((read) => read.markers.length > 0).at(-1);
  const monorepo = outermost === undefined || outermost.dir === base
    ? []
    : [candidateAt(outermost.dir, 'monorepo', walk, named, fs)];

  return {
    start,
    candidates: [candidateAt(base, source, walk, named, fs), ...monorepo],
    warnings: walk.flatMap((read) => read.warnings),
  };
}
