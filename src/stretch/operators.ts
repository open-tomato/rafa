/**
 * The stretch operators: where the installed package keeps them, the
 * rafa version they ship with, the one copy each stretch makes of them,
 * and the links an older launcher left in `~/.claude` (#816).
 *
 * The rules are the ones `scripts/stretch/stretch.sh` followed, with one
 * change: the operators come from the installed package, never from a
 * checkout's `src/`.
 *
 *   - **Where.** {@link bundledOperatorsDirectory} is `bundled/operators`
 *     beside the running entry with its links resolved, found the way
 *     `bundledAgentsDirectory` (`src/inventory/trees.ts`) finds
 *     `bundled/agents`. An installed package runs `dist/cli.js`, so that
 *     is `dist/bundled/operators`, which the build copies from
 *     `src/bundled/`.
 *   - **The version.** {@link findOperators} reads `version` from the
 *     `package.json` one folder above the entry's, the package root in
 *     both an install (`dist/cli.js`) and a checkout (`src/rafa.ts`).
 *     When that file is missing or names no version, it reads the
 *     version inlined into the running build (`RAFA_VERSION`) and says
 *     so in `versionSource`.
 *   - **The refusal.** A folder with no `.claude-plugin/plugin.json` is
 *     no Claude Code plugin, so `--plugin-dir` would load nothing from
 *     it: {@link findOperators} reads it as `missing`, and
 *     {@link copyOperators} refuses before it looks at any copy.
 *   - **Once.** {@link copyOperators} copies the folder into
 *     `.rafa/stretch/<n>/operators/` when no copy is there, and keeps a
 *     copy that is there whatever it holds, so a self-update never
 *     changes a stretch that runs. The copy is made under a temporary
 *     name beside it and renamed into place, so a copy that failed half
 *     way is never read as made.
 *   - **Old links.** {@link linkedOperators} lists the symbolic links
 *     named `~/.claude/agents/rafa-stretch-*.md` and
 *     `~/.claude/skills/rafa-stretch-*` (the script's `warn_linked`),
 *     and {@link linkedOperatorLines} words the warning. HOME is read
 *     through {@link OperatorsSeams.home}, so no test reads the real one.
 *
 * Every effect goes through {@link OperatorsSeams}. Nothing outside
 * `src/commands/stretch/` and `src/commands/doctor-stretch.ts` imports
 * this module, so the stretch logic can move into its own package.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { RAFA_VERSION } from '../cli/version.js';
import { errorCode } from '../loop/sessions.js';
import { readManifestVersion } from '../release/version.js';
import { realEntry } from '../schema/tiers.js';

import { stretchFolder } from './folder.js';

/** The operators folder beside the running entry. */
export const BUNDLED_OPERATORS_DIR = join('bundled', 'operators');

/** The file that makes the operators folder a Claude Code plugin. */
export const PLUGIN_MANIFEST = join('.claude-plugin', 'plugin.json');

/** The name of a stretch's own copy inside `.rafa/stretch/<n>/`. */
export const OPERATORS_COPY = 'operators';

/** The prefix every operator's file or folder name carries. */
export const OPERATOR_PREFIX = 'rafa-stretch-';

/** One name in a listed directory. */
export interface LinkEntry {
  readonly name: string;
  readonly isSymbolicLink: boolean;
}

/** The filesystem effects the operators go through. */
export interface OperatorsFs {
  /** Whether anything is at `path`. */
  readonly exists: (path: string) => boolean;
  /** The text of `file`, or null when it does not exist. */
  readonly readText: (file: string) => string | null;
  /** The entries of `dir`, or none when it does not exist. */
  readonly list: (dir: string) => readonly LinkEntry[];
  /** Copies the tree at `from` to `to`, which does not exist yet, so that a half copy never sits at `to`. */
  readonly copyTree: (from: string, to: string) => void;
}

/** The effects and readings every function here reaches through. */
export interface OperatorsSeams {
  readonly fs: OperatorsFs;
  /** The running entry, as `Bun.main` names it; its links are resolved. */
  readonly entry: string;
  /** The version inlined into the running build. */
  readonly buildVersion: string;
  /** The home folder whose `.claude/` may hold old links. */
  readonly home: () => string;
}

/** Where a version was read. */
export type VersionSource = 'manifest' | 'build';

/** The operators of the installed package, ready to copy. */
export interface OperatorsFound {
  readonly kind: 'found';
  readonly dir: string;
  readonly version: string;
  readonly versionSource: VersionSource;
}

/** A package whose operators folder carries no plugin manifest. */
export interface OperatorsMissing {
  readonly kind: 'missing';
  readonly dir: string;
  /** The manifest path that is not there. */
  readonly manifest: string;
  readonly reason: string;
}

/** What {@link findOperators} read. */
export type OperatorsReading = OperatorsFound | OperatorsMissing;

/** A copy this call made. */
export interface OperatorsCopied {
  readonly kind: 'copied';
  readonly copy: string;
  readonly from: string;
  readonly version: string;
  readonly versionSource: VersionSource;
}

/** A copy that was already there, kept as it is. */
export interface OperatorsKept {
  readonly kind: 'kept';
  readonly copy: string;
}

/** What {@link copyOperators} did. */
export type OperatorsCopyResult = OperatorsCopied | OperatorsKept | OperatorsMissing;

/** `bundled/operators` beside the entry, links resolved. */
export function bundledOperatorsDirectory(entry?: string): string {
  return join(dirname(realEntry(entry ?? Bun.main)), BUNDLED_OPERATORS_DIR);
}

/** The `package.json` of the package the entry belongs to: one folder above the entry's. */
export function packageManifestPath(entry?: string): string {
  return join(dirname(dirname(realEntry(entry ?? Bun.main))), 'package.json');
}

/** `<root>/.rafa/stretch/<n>/operators`. Throws on a number that is no stretch number. */
export function operatorsCopyPath(root: string, n: number): string {
  return join(stretchFolder(root, n), OPERATORS_COPY);
}

/**
 * The installed package's operators and its rafa version, or `missing`
 * when the folder carries no `.claude-plugin/plugin.json`.
 */
export function findOperators(seams: OperatorsSeams = defaultOperatorsSeams()): OperatorsReading {
  const dir = bundledOperatorsDirectory(seams.entry);
  const manifest = join(dir, PLUGIN_MANIFEST);
  if (!seams.fs.exists(manifest)) {
    return {
      kind: 'missing',
      dir,
      manifest,
      reason: `${manifest} is missing: this rafa install carries no stretch operators`,
    };
  }
  const text = seams.fs.readText(packageManifestPath(seams.entry));
  const version = text === null
    ? null
    : readManifestVersion(text);
  return version === null
    ? { kind: 'found', dir, version: seams.buildVersion, versionSource: 'build' }
    : { kind: 'found', dir, version, versionSource: 'manifest' };
}

/**
 * Copies the installed operators into stretch `n`'s folder the first
 * time, and keeps the copy every time after. Refuses, copying nothing,
 * when the package carries no plugin manifest.
 */
export function copyOperators(root: string, n: number, seams: OperatorsSeams = defaultOperatorsSeams()): OperatorsCopyResult {
  const found = findOperators(seams);
  if (found.kind === 'missing') return found;
  const copy = operatorsCopyPath(root, n);
  if (seams.fs.exists(copy)) return { kind: 'kept', copy };
  seams.fs.copyTree(found.dir, copy);
  return { kind: 'copied', copy, from: found.dir, version: found.version, versionSource: found.versionSource };
}

/**
 * The operators still linked into `~/.claude`: every symbolic link named
 * `agents/rafa-stretch-*.md` or `skills/rafa-stretch-*`, agents first,
 * each sorted by name.
 */
export function linkedOperators(seams: OperatorsSeams = defaultOperatorsSeams()): readonly string[] {
  const claude = join(seams.home(), '.claude');
  const agents = linksIn(seams.fs, join(claude, 'agents'), (name) => name.endsWith('.md'));
  const skills = linksIn(seams.fs, join(claude, 'skills'), () => true);
  return [...agents, ...skills];
}

/** The warning `start` prints for {@link linkedOperators}, or no line when there are none. */
export function linkedOperatorLines(paths: readonly string[]): readonly string[] {
  if (paths.length === 0) return [];
  return [
    `stretch: linked operators found: ${paths.join(' ')}`,
    '  this stretch uses its own copy; remove the links once no stretch started with them runs',
  ];
}

/** The line a command prints for a refusal: the reason, and what to do. */
export function missingOperatorsLine(missing: OperatorsMissing): string {
  return `stretch: ${missing.reason}; reinstall rafa or update it with rafa self-update`;
}

/** The real filesystem, entry, build version and HOME. */
export function defaultOperatorsSeams(): OperatorsSeams {
  return {
    fs: nodeOperatorsFs,
    entry: Bun.main,
    buildVersion: RAFA_VERSION,
    home: () => process.env['HOME'] ?? homedir(),
  };
}

/** {@link OperatorsFs} over `node:fs`; a missing path reads as empty or null, any other failure throws. */
export const nodeOperatorsFs: OperatorsFs = {
  exists: (path) => existsSync(path),
  readText(file) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
  list(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isSymbolicLink: entry.isSymbolicLink() }));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  },
  copyTree(from, to) {
    mkdirSync(dirname(to), { recursive: true });
    const partial = `${to}.partial-${String(process.pid)}`;
    rmSync(partial, { recursive: true, force: true });
    try {
      cpSync(from, partial, { recursive: true, dereference: true });
      renameSync(partial, to);
    } catch (error) {
      rmSync(partial, { recursive: true, force: true });
      throw error;
    }
  },
};

function linksIn(fs: OperatorsFs, dir: string, keep: (name: string) => boolean): readonly string[] {
  return fs.list(dir)
    .filter((entry) => entry.isSymbolicLink && entry.name.startsWith(OPERATOR_PREFIX) && keep(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(dir, name));
}
