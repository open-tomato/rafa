/**
 * Installs a rafa checkout as the global rafa: the logic `bun run snapshot`
 * (`scripts/snapshot-runtime.ts`) and `rafa self-update`
 * (`commands/self-update.ts`) share. Both callers are thin: the script
 * runs from the checkout and `self-update` from the bundle, which reaches
 * `scripts/` never, so the logic lives here under `src/`.
 *
 * The global `rafa` runs from a copy of the build, never from a
 * checkout's `dist/`. `bun run build` opens with `rm -rf dist`, so a loop
 * running from `dist/` has its runner replaced by the first task that
 * builds. {@link installRuntime} takes that copy.
 *
 * In order, it:
 *   1. reads the checkout's `package.json`, refusing one whose `name` is
 *      not rafa's or whose `version` could not name one directory;
 *   2. reads the config as `loop start` resolves it (`config-load.ts`),
 *      for `plan.dir`;
 *   3. refuses while a tracker in `plan.dir` has a task left, before
 *      building;
 *   4. refuses while `~/.rafa/runtime/<version>/` is already there,
 *      unless it was forced, before building;
 *   5. runs the build;
 *   6. copies `dist/` into a staging directory beside
 *      `~/.rafa/runtime/<version>/` and renames it into place;
 *   7. links `~/.rafa/bin/rafa` at the copied `cli.js`, making the bin
 *      directory when it is missing;
 *   8. logs the path the link resolves to.
 *
 * What was refused or could not run is answered, never written:
 * {@link outcomeProblem} words it, so the script writes it to stderr and
 * the command carries it as its `CommandExit` message. Exit codes, for
 * both: 0 done, 1 refused, 2 could not run. 2 is its own code on purpose:
 * a manifest, config or tracker that could not be read, or a build, copy
 * or link that failed, is never read as a refusal, and a refusal is never
 * read as something broken.
 *
 * ## The bin sits in `~/.rafa/bin`, not in bun's
 *
 * Observed 2026-09-14: `bun link` in this checkout re-pointed
 * `~/.bun/bin/rafa` at the checkout's `dist/` with no message, undoing
 * the snapshot. So the link is `~/.rafa/bin/rafa`, which no bun command
 * writes, and `rafa init` and `rafa doctor` warn when that directory is
 * not on `PATH` ahead of `~/.bun/bin` (`project/bin-path.ts`). A
 * `~/.bun/bin/rafa` an earlier snapshot left is not touched. The bin is
 * under the home as `HOME` names it, so a scratch `HOME` moves every path
 * this module writes.
 *
 * ## A checkout that is not rafa's refuses
 *
 * `self-update` runs in whatever project the dispatcher resolved. Built
 * and installed there, a project that is not a rafa checkout would replace
 * the global rafa with its own `dist/`. So a `package.json` whose `name`
 * is not this package's is answered as could-not-run at the `manifest`
 * step, before anything else is read.
 *
 * ## A tracker with a task left refuses
 *
 * A plan with a task left is a run that may still be going, from the
 * very runtime this would replace, and its remaining tasks would meet a
 * runner and a prompt it never started with. A tracker has a task left
 * when `findNextTask` answers one over its text, an open or a blocked
 * task, so a task line inside a closed `rafa:*` block is skipped exactly
 * as the loop skips it. Trackers sit beside their plans (`trackerPathFor`)
 * in `plan.dir`, `.rafa/plans` unless a config names another, and are
 * looked for there alone: not in its subdirectories and not at the
 * project root, where a hand-written `PLAN.md` falls back to. A `plan.dir`
 * that does not exist holds none. The refusal names every tracker with a
 * task left.
 *
 * ## A runtime already there refuses, and `--force` replaces it whole
 *
 * `~/.rafa/runtime/<version>/` holds one version's build, and a loop may
 * be running from it. Installing a second build under the same version
 * would swap the runner under that loop, so an install whose version's
 * directory is already there is refused at the `runtime-exists` reason,
 * before the build, naming the directory and the version `package.json`
 * gave. Raising the version in `package.json` gives the new build a
 * directory of its own; {@link InstallOptions.force} installs over the
 * old one anyway.
 *
 * Forced, the directory is replaced and never merged: nothing the old
 * build left is kept, so a stale content-hashed chunk, or any other file
 * planted there, is gone afterwards. The replacement is built beside the
 * directory rather than into it, so no reader ever meets a half-replaced
 * runtime: `dist/` is copied into a staging directory in the runtime
 * root, the old directory is renamed aside, the staging directory is
 * renamed into its place, and only then is the old one removed. A rename
 * that fails after the old directory moved aside is answered by renaming
 * it back, so the directory holds one whole build either way. A loop
 * reading a file it already opened reads on; a file it opens after the
 * removal is gone, which is what forcing an install over a live runtime
 * costs. Measured 2026-09-17 on macOS 25.6 with bun 1.3.14: a descriptor
 * opened before the swap still read the old file's bytes after that
 * file's directory had been renamed aside and removed, and opening the
 * same path afterwards answered `ENOENT`.
 *
 * Each file lands inside the staging directory by a rename too
 * ({@link copyTree}), and the link is created under a temporary name and
 * renamed over `rafa`, so a shell meets the old link or the new one and
 * never none. `ln -sf` promises that neither, since its `-f` unlinks the
 * old link before it makes the new one (ln(1)).
 *
 * ## Seams
 *
 * The checkout, the home, the build runner and where lines go are passed
 * in ({@link InstallSeams}), so a test points every path under a temporary
 * directory of its own and never runs the real build.
 */
import type { TaskInfo } from '../utils/tracker.js';

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';

import { name as RAFA_PACKAGE_NAME } from '../../package.json';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { RAFA_BIN_DIR } from '../project/bin-path.js';
import { RUNTIME_ENTRY, RUNTIME_SUBDIR, VERSION_SHAPE } from '../start/runtime.js';
import { findNextTask } from '../utils/tracker.js';

export { RAFA_PACKAGE_NAME };

/** The link's name inside `~/.rafa/bin`. */
export const LINK_NAME = 'rafa';

/** How both callers spell {@link InstallOptions.force} on their line. */
export const FORCE_FLAG = '--force';

export const EXIT_DONE = 0;
export const EXIT_REFUSED = 1;
export const EXIT_COULD_NOT_RUN = 2;

/**
 * A tracker's file name, as `trackerPathFor` derives one from a plan's:
 * `PLAN_TRACKER.md` or `PLAN_TRACKER-<stub>.md`.
 */
export const TRACKER_NAME = /^PLAN_TRACKER(-[^/]*)?\.md$/;

/** Where a build's output lines go when the runner reads them rather than handing over its streams. */
export interface BuildLines {
  /** A line the build wrote to stdout. */
  readonly info: (line: string) => void;
  /** A line the build wrote to stderr. */
  readonly warn: (line: string) => void;
}

/** Where one install reads and writes, and how it builds and speaks. */
export interface InstallSeams {
  /** The checkout to install: its `package.json`, its config, its trackers and its `dist/`. */
  readonly repoRoot: string;
  /** The home the runtime directory, the bin directory and the user config sit under. */
  readonly home: string;
  /** Builds `repoRoot` into its `dist/`, answering the build's exit code. */
  readonly build: (repoRoot: string) => number;
  /** Where progress and the resolved path go. */
  readonly log: (line: string) => void;
  /** Where a config warning goes. */
  readonly warn: (line: string) => void;
}

/** What one install is told to do beyond where it reads and writes. */
export interface InstallOptions {
  /**
   * Replace a `~/.rafa/runtime/<version>/` already there, whole, instead
   * of refusing it; see the module note. False unless it is set.
   */
  readonly force?: boolean;
}

/** A tracker with a task left. */
export interface OpenTracker {
  /** The tracker's path, relative to the repo root. */
  readonly path: string;
  /** The task `findNextTask` answers over the tracker's text. */
  readonly task: TaskInfo;
}

/** The step an install that could not run stopped at. */
export type InstallStage = 'manifest' | 'config' | 'trackers' | 'build' | 'copy' | 'link';

/**
 * What one install did. A refusal carries the `reason` it refused for: a
 * tracker with a task left, or a runtime already installed.
 */
export type InstallOutcome =
  | {
    readonly kind: 'done';
    /** The version the build was installed as, from `package.json`. */
    readonly version: string;
    /** The runtime directory the build was copied into. */
    readonly runtimeDir: string;
    /** `~/.rafa/bin/rafa`. */
    readonly linkPath: string;
    /** The path the link resolves to, the copied `cli.js`. */
    readonly resolved: string;
    /** How many files were copied. */
    readonly copied: number;
  }
  | {
    readonly kind: 'refused';
    readonly reason: 'trackers';
    /** The `plan.dir` looked in, absolute. */
    readonly planDir: string;
    readonly trackers: readonly OpenTracker[];
  }
  | {
    readonly kind: 'refused';
    readonly reason: 'runtime-exists';
    /** The version `package.json` gave, whose directory is already there. */
    readonly version: string;
    /** `~/.rafa/runtime/<version>/`, the directory that is already there. */
    readonly runtimeDir: string;
  }
  | { readonly kind: 'failed'; readonly stage: InstallStage; readonly message: string };

/** What a step reached before the build leaves changed, which is nothing. */
const NOTHING_DONE = 'nothing was built, copied or linked';

/** What a failure at each step has and has not changed. */
const AFTERMATH: Readonly<Record<InstallStage, string>> = {
  manifest: NOTHING_DONE,
  config: NOTHING_DONE,
  trackers: NOTHING_DONE,
  build: 'nothing was copied or linked',
  copy: 'the runtime directory holds the build it held or this one, never a mix, and the link was not changed',
  link: 'the runtime directory holds this build, and the link may not point at it',
};

/** A step that could not run, carrying the step to the outcome. */
class StageFailure extends Error {
  readonly stage: InstallStage;

  constructor(stage: InstallStage, message: string) {
    super(message);
    this.stage = stage;
  }
}

/** The process exit code for an outcome. */
export function exitCodeFor(outcome: InstallOutcome): number {
  switch (outcome.kind) {
    case 'done':
      return EXIT_DONE;
    case 'refused':
      return EXIT_REFUSED;
    case 'failed':
      return EXIT_COULD_NOT_RUN;
  }
}

/**
 * The lines saying why an install refused or could not run, or null for
 * one that is done. The caller writes them: stderr for the script, the
 * `CommandExit` message for `self-update`.
 */
export function outcomeProblem(outcome: InstallOutcome, repoRoot: string): string[] | null {
  switch (outcome.kind) {
    case 'done':
      return null;
    case 'refused':
      return outcome.reason === 'trackers'
        ? trackerRefusalLines(outcome.trackers, relative(repoRoot, outcome.planDir) || '.')
        : runtimeRefusalLines(outcome.runtimeDir, outcome.version);
    case 'failed':
      return [`FAIL — ${outcome.stage}: ${outcome.message}`, `${AFTERMATH[outcome.stage]}.`];
  }
}

function trackerRefusalLines(open: readonly OpenTracker[], planDir: string): string[] {
  return [
    `REFUSED — ${open.length} plan tracker(s) in ${planDir} still hold a task, and a loop may be running from the runtime this would replace:`,
    ...open.map(({ path, task }) => {
      const box = task.status === 'blocked'
        ? '[BLOCKED]'
        : '[ ]';
      return `  ${path}:${task.lineNum + 1}  ${box} ${task.task}`;
    }),
    `${NOTHING_DONE}. Finish those plans, then run it again.`,
  ];
}

function runtimeRefusalLines(runtimeDir: string, version: string): string[] {
  return [
    `REFUSED — ${runtimeDir} already holds version ${version}, the version in package.json, and a loop may be running from it.`,
    `${NOTHING_DONE}. Raise the version in package.json, or run it again with ${FORCE_FLAG} to replace that directory whole.`,
  ];
}

/**
 * Every tracker file directly in `planDir`, as paths relative to the repo
 * root, sorted by name. A `planDir` that does not exist holds none; one
 * that cannot be read throws.
 */
export function listTrackers(repoRoot: string, planDir: string): string[] {
  const dir = resolve(repoRoot, planDir);
  return entryNames(dir)
    .filter((entry) => TRACKER_NAME.test(entry))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile())
    .map((path) => relative(repoRoot, path));
}

/** Every tracker in `planDir` with a task left, in {@link listTrackers} order. */
export function openTrackers(repoRoot: string, planDir: string): OpenTracker[] {
  return listTrackers(repoRoot, planDir).flatMap((path) => {
    const task = findNextTask(readFileSync(join(repoRoot, path), 'utf8'));
    return task
      ? [{ path, task }]
      : [];
  });
}

/**
 * The `version` in the repo root's `package.json`, refused unless its
 * `name` is rafa's and the version names one directory.
 */
export function readManifestVersion(repoRoot: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const record = typeof manifest === 'object' && manifest !== null
    ? manifest as Record<string, unknown>
    : {};
  if (record['name'] !== RAFA_PACKAGE_NAME) {
    throw new Error(`${join(repoRoot, 'package.json')} names ${JSON.stringify(record['name'])}, not ${RAFA_PACKAGE_NAME}: this is no rafa checkout`);
  }
  const version = record['version'];
  if (typeof version !== 'string' || !VERSION_SHAPE.test(version)) {
    throw new Error(`package.json names no usable version: ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * Copies every file under `from` to the same relative path under `to`,
 * over whatever is there, answering how many files it copied. Each lands
 * by a rename, and a file `to` holds that `from` does not stays. An entry
 * that is neither a file nor a directory throws.
 *
 * An install copies into a staging directory of its own, so what `to`
 * held is only ever what an interrupted run left there.
 */
export function copyTree(from: string, to: string): number {
  mkdirSync(to, { recursive: true });
  let copied = 0;
  const entries = readdirSync(from, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(source, target);
    } else if (entry.isFile()) {
      replaceFile(source, target);
      copied += 1;
    } else {
      throw new Error(`${source} is neither a file nor a directory`);
    }
  }
  return copied;
}

/**
 * Copies `from` into a staging directory beside `to` and renames that
 * into `to`'s place, replacing whatever `to` held, and answers how many
 * files it copied. The staging directory is removed on any failure, and
 * a `to` renamed aside is renamed back when the staging directory could
 * not take its place, so `to` holds one whole build either way. See the
 * module note.
 */
export function replaceTree(from: string, to: string): number {
  const staging = temporaryName(to);
  rmSync(staging, { recursive: true, force: true });
  try {
    const copied = copyTree(from, staging);
    swapIn(staging, to);
    return copied;
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/** Renames `staging` into `to`'s place and removes what `to` held. */
function swapIn(staging: string, to: string): void {
  if (!existsSync(to)) {
    renameSync(staging, to);
    return;
  }
  const outgoing = `${temporaryName(to)}.outgoing`;
  rmSync(outgoing, { recursive: true, force: true });
  renameSync(to, outgoing);
  try {
    renameSync(staging, to);
  } catch (err) {
    renameSync(outgoing, to);
    throw err;
  }
  rmSync(outgoing, { recursive: true, force: true });
}

/**
 * Points `linkPath` at `target`, making its directory when missing,
 * creating the link under a temporary name beside it and renaming that
 * over `linkPath`, and answers the path the link then resolves to. Throws
 * when that is not where `target` resolves.
 */
export function relink(linkPath: string, target: string): string {
  mkdirSync(dirname(linkPath), { recursive: true });
  const temporary = temporaryName(linkPath);
  // A link left by an interrupted run would make `symlinkSync` refuse.
  rmSync(temporary, { force: true });
  try {
    symlinkSync(target, temporary);
    renameSync(temporary, linkPath);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
  const resolved = realpathSync(linkPath);
  const expected = realpathSync(target);
  if (resolved !== expected) {
    throw new Error(`${linkPath} resolves to ${resolved}, not ${expected}`);
  }
  return resolved;
}

/**
 * Runs `bun run --silent build` in `repoRoot` with this process's bun,
 * answering its exit code. With no `lines` the build writes to this
 * process's streams; with them, its output is read and handed over line
 * by line once it ends, so a caller writing NDJSON never has a build's
 * bytes among its events.
 *
 * `--silent` because `bun run` echoes the script's command line to
 * stderr, which `lines.warn` would pass on as a warning from every clean
 * build. Measured on bun 1.3.14: a clean build wrote 294 bytes to stderr
 * without the flag and none with it, and a script failing under it still
 * wrote its own stderr and exited with its own code, 3.
 */
export function runBuild(repoRoot: string, lines?: BuildLines): number {
  const stdio = lines
    ? 'pipe'
    : 'inherit';
  const run = Bun.spawnSync([process.execPath, 'run', '--silent', 'build'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter),
    },
    stdin: 'ignore',
    stdout: stdio,
    stderr: stdio,
  });
  if (lines) {
    for (const line of textLines(run.stdout)) lines.info(line);
    for (const line of textLines(run.stderr)) lines.warn(line);
  }
  return run.exitCode;
}

/** The non-empty lines of a captured stream. */
function textLines(bytes: Uint8Array | undefined): string[] {
  if (!bytes) return [];
  return new TextDecoder().decode(bytes)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * Installs one checkout, answering what it did. A step that throws is
 * answered as `failed` at that step; see the module note for the order.
 * `options.force` replaces a runtime directory already there rather than
 * refusing it.
 */
export function installRuntime(seams: InstallSeams, options: InstallOptions = {}): InstallOutcome {
  try {
    return runInstall(seams, options);
  } catch (err) {
    if (!(err instanceof StageFailure)) throw err;
    return { kind: 'failed', stage: err.stage, message: err.message };
  }
}

function runInstall(seams: InstallSeams, options: InstallOptions): InstallOutcome {
  const { repoRoot, home, log } = seams;
  const runtimeRoot = join(home, RUNTIME_SUBDIR);
  const linkPath = join(home, RAFA_BIN_DIR, LINK_NAME);
  log(`repo root: ${repoRoot}`);
  log(`runtime root: ${runtimeRoot}`);
  log(`link: ${linkPath}`);

  const version = inStage('manifest', () => readManifestVersion(repoRoot));
  const planDir = inStage('config', () => resolve(repoRoot, loadConfig({ root: repoRoot, home }, {}, seams.warn).config.planDir));
  log(`plan dir: ${planDir}`);

  const open = inStage('trackers', () => openTrackers(repoRoot, planDir));
  if (open.length > 0) return { kind: 'refused', reason: 'trackers', planDir, trackers: open };

  const distDir = join(repoRoot, 'dist');
  const runtimeDir = join(runtimeRoot, version);
  const installed = existsSync(runtimeDir);
  if (installed && options.force !== true) {
    return { kind: 'refused', reason: 'runtime-exists', version, runtimeDir };
  }

  log(`building ${repoRoot}`);
  const code = inStage('build', () => seams.build(repoRoot));
  if (code !== 0) throw new StageFailure('build', `the build exited ${code}`);
  if (!existsSync(join(distDir, RUNTIME_ENTRY))) {
    throw new StageFailure('build', `the build exited 0 and left no ${join(distDir, RUNTIME_ENTRY)}`);
  }

  log(installed
    ? `copying ${distDir} over ${runtimeDir}, replacing it whole`
    : `copying ${distDir} into ${runtimeDir}`);
  const copied = inStage('copy', () => replaceTree(distDir, runtimeDir));
  log(`copied ${copied} file(s)`);

  const resolved = inStage('link', () => relink(linkPath, join(runtimeDir, RUNTIME_ENTRY)));
  log(`${linkPath} resolves to ${resolved}`);
  return { kind: 'done', version, runtimeDir, linkPath, resolved, copied };
}

/** Runs one step, answering any throw from it as a failure at that step. */
function inStage<T>(stage: InstallStage, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof StageFailure) throw err;
    throw new StageFailure(stage, messageOf(err));
  }
}

/** The names in `dir`, or none when it does not exist. Any other failure throws. */
function entryNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Copies `source` over `target` by way of a temporary file renamed into place. */
function replaceFile(source: string, target: string): void {
  const temporary = temporaryName(target);
  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, statSync(source).mode & 0o7777);
    renameSync(temporary, target);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}

/** A name beside `path`, in its directory so a rename from it never crosses a filesystem. */
function temporaryName(path: string): string {
  return join(dirname(path), `.${basename(path)}.snapshot-${process.pid}`);
}
