/**
 * Runtime snapshot:
 * The global `rafa` runs from a copy of the build, never from this
 * checkout's `dist/`. `bun run build` opens with `rm -rf dist`, so a loop
 * running from `dist/` has its runner replaced by the first task that
 * builds. This script takes that copy.
 *
 * Usage:
 *   bun run snapshot
 *
 * In order, it:
 *   1. refuses while any plan tracker has a task left, before building;
 *   2. runs `bun run build`;
 *   3. copies `dist/` into `~/.rafa/runtime/<version>/`, taking `version`
 *      from `package.json`;
 *   4. relinks `~/.bun/bin/rafa` at the copied `cli.js`;
 *   5. prints the path the link resolves to.
 *
 * Exit codes: 0 done, 1 refused, 2 the snapshot could not run.
 * As in `control-byte-gate.ts`, 2 is its own code on purpose: a tracker
 * that could not be read, or a build, copy or link that failed, is never
 * read as a refusal, and a refusal is never read as something broken.
 *
 * ## A tracker with a task left refuses
 *
 * A plan with a task left is a run that may still be going, from the
 * very runtime this would replace, and its remaining tasks would meet a
 * runner and a prompt it never started with. A tracker has a task left
 * when `findNextTask` answers one over its text, so a task line inside a
 * closed `rafa:*` block is skipped exactly as the loop skips it.
 * Trackers sit beside their plans (`trackerPathFor`) and are looked for
 * in `.plans/` and the repo root, where `rafa start` looks for a plan by
 * default. The refusal names every tracker with a task left.
 *
 * ## Replacing a runtime in use
 *
 * The version's directory usually exists already, and a loop may be
 * running from it. So each file is copied under a temporary name beside
 * its destination and renamed over it, and the link is created under a
 * temporary name and renamed over `rafa`: a reader meets the old file or
 * the new one and never a torn one, and a shell meets the old link or the
 * new one and never none. `ln -sf` promises neither, since its `-f`
 * unlinks the old link before it makes the new one (ln(1)). A file the
 * new build no longer writes stays where it is, a stale content-hashed
 * chunk being unreferenced and harmless, and nothing here deletes a
 * directory.
 *
 * ## Seams
 *
 * The repo root, the home, the bin directory and the build runner are
 * passed in ({@link SnapshotSeams}), so a test points every path under a
 * temporary directory of its own and never runs the real build. The bin
 * directory defaults to `.bun/bin` under the home, as `HOME` names it,
 * and not to `BUN_INSTALL`: a scratch `HOME` then moves every path this
 * script writes, even in a shell whose `BUN_INSTALL` names the real one.
 */
import type { TaskInfo } from '../src/utils/tracker.js';

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
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

import { findNextTask } from '../src/utils/tracker.js';

/** Prefix on every line this script writes. */
const TAG = '[snapshot]';

/** Where runtimes sit under the home: `~/.rafa/runtime/<version>/`. */
export const RUNTIME_SUBDIR = join('.rafa', 'runtime');

/** Where the link sits under the home, by default. */
export const BIN_SUBDIR = join('.bun', 'bin');

/** The link's name inside the bin directory. */
export const LINK_NAME = 'rafa';

/** The build's entry point, in `dist/` and in a runtime directory alike. */
export const CLI_FILE = 'cli.js';

export const EXIT_DONE = 0;
export const EXIT_REFUSED = 1;
export const EXIT_COULD_NOT_RUN = 2;

/**
 * A tracker's file name, as `trackerPathFor` derives one from a plan's:
 * `PLAN_TRACKER.md` or `PLAN_TRACKER-<stub>.md`.
 */
export const TRACKER_NAME = /^PLAN_TRACKER(-[^/]*)?\.md$/;

/** The directories trackers are looked for in, relative to the repo root. */
export const TRACKER_DIRS: readonly string[] = ['.plans', '.'];

/**
 * A version fit to name one directory. Semver's shape: it opens with a
 * digit and holds no separator, so it can never be `..` or reach outside
 * the runtime root.
 */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/** Where one snapshot run reads and writes, and how it builds and speaks. */
export interface SnapshotSeams {
  /** The checkout to snapshot: its trackers, `package.json` and `dist/`. */
  repoRoot: string;
  /** The home the runtime directory sits under. */
  home: string;
  /** The directory holding the `rafa` link. */
  binDir: string;
  /** Builds `repoRoot` into its `dist/`, answering the build's exit code. */
  build: (repoRoot: string) => number;
  /** Where progress and the resolved path go. */
  log: (line: string) => void;
  /** Where a refusal and a failure go. */
  error: (line: string) => void;
}

/** A tracker with a task left. */
export interface OpenTracker {
  /** The tracker's path, relative to the repo root. */
  path: string;
  /** The task `findNextTask` answers over the tracker's text. */
  task: TaskInfo;
}

/** The step a snapshot that could not run stopped at. */
export type SnapshotStage = 'trackers' | 'version' | 'build' | 'copy' | 'link';

/** What one run did. */
export type SnapshotOutcome =
  | {
    kind: 'done';
    /** The runtime directory the build was copied into. */
    runtimeDir: string;
    linkPath: string;
    /** The path the link resolves to, the copied `cli.js`. */
    resolved: string;
    /** How many files were copied. */
    copied: number;
  }
  | { kind: 'refused'; trackers: OpenTracker[] }
  | { kind: 'failed'; stage: SnapshotStage; message: string };

/** What a failure at each step has and has not changed. */
const AFTERMATH: Readonly<Record<SnapshotStage, string>> = {
  trackers: 'nothing was built, copied or relinked',
  version: 'nothing was built, copied or relinked',
  build: 'nothing was copied or relinked',
  copy: 'the runtime directory may hold part of this build, and the link was not changed',
  link: 'the runtime directory holds this build, and the link may not point at it',
};

/** A step that could not run, carrying the step to the outcome. */
class StageFailure extends Error {
  readonly stage: SnapshotStage;

  constructor(stage: SnapshotStage, message: string) {
    super(message);
    this.stage = stage;
  }
}

/** The process exit code for an outcome. */
export function exitCodeFor(outcome: SnapshotOutcome): number {
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
 * Every tracker file in {@link TRACKER_DIRS}, relative to the repo root,
 * sorted by name within each directory. A directory that does not exist
 * holds none; one that cannot be read throws.
 */
export function listTrackers(repoRoot: string): string[] {
  return TRACKER_DIRS.flatMap((dir) => entryNames(join(repoRoot, dir))
    .filter((name) => TRACKER_NAME.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dir, name))
    .filter((path) => statSync(join(repoRoot, path)).isFile()));
}

/** Every tracker with a task left, in {@link listTrackers} order. */
export function openTrackers(repoRoot: string): OpenTracker[] {
  return listTrackers(repoRoot).flatMap((path) => {
    const task = findNextTask(readFileSync(join(repoRoot, path), 'utf8'));
    return task
      ? [{ path, task }]
      : [];
  });
}

/** The `version` in the repo root's `package.json`, refused unless it names one directory. */
export function readVersion(repoRoot: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? manifest.version
    : undefined;
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
 * Points `linkPath` at `target`, creating the link under a temporary name
 * beside it and renaming that over `linkPath`, and answers the path the
 * link then resolves to. Throws when that is not where `target` resolves.
 */
export function relink(linkPath: string, target: string): string {
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

/** Runs `bun run build` in `repoRoot` with this process's bun, answering its exit code. */
export function runBuild(repoRoot: string): number {
  return Bun.spawnSync([process.execPath, 'run', 'build'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter),
    },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode;
}

/** The seams `bun run snapshot` runs with: this checkout, `HOME`, and the real build. */
export function defaultSeams(): SnapshotSeams {
  const home = homedir();
  return {
    repoRoot: resolve(import.meta.dir, '..'),
    home,
    binDir: join(home, BIN_SUBDIR),
    build: runBuild,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}

/**
 * Takes one snapshot, answering what it did. A step that throws is
 * answered as `failed` at that step, and written to `seams.error`.
 */
export function snapshotRuntime(seams: SnapshotSeams): SnapshotOutcome {
  try {
    return runSnapshot(seams);
  } catch (err) {
    if (!(err instanceof StageFailure)) throw err;
    seams.error(`${TAG} FAIL — ${err.stage}: ${err.message}`);
    seams.error(`${TAG} ${AFTERMATH[err.stage]}.`);
    return { kind: 'failed', stage: err.stage, message: err.message };
  }
}

function runSnapshot(seams: SnapshotSeams): SnapshotOutcome {
  const { repoRoot, log } = seams;
  const runtimeRoot = join(seams.home, RUNTIME_SUBDIR);
  const linkPath = join(seams.binDir, LINK_NAME);
  log(`${TAG} repo root: ${repoRoot}`);
  log(`${TAG} runtime root: ${runtimeRoot}`);
  log(`${TAG} link: ${linkPath}`);

  const open = inStage('trackers', () => openTrackers(repoRoot));
  if (open.length > 0) {
    reportRefusal(open, seams.error);
    return { kind: 'refused', trackers: open };
  }

  const version = inStage('version', () => readVersion(repoRoot));
  const distDir = join(repoRoot, 'dist');
  const runtimeDir = join(runtimeRoot, version);

  log(`${TAG} building ${repoRoot}`);
  const code = inStage('build', () => seams.build(repoRoot));
  if (code !== 0) throw new StageFailure('build', `the build exited ${code}`);
  if (!existsSync(join(distDir, CLI_FILE))) {
    throw new StageFailure('build', `the build exited 0 and left no ${join(distDir, CLI_FILE)}`);
  }

  log(`${TAG} copying ${distDir} into ${runtimeDir}`);
  const copied = inStage('copy', () => copyTree(distDir, runtimeDir));
  log(`${TAG} copied ${copied} file(s)`);

  const resolved = inStage('link', () => relink(linkPath, join(runtimeDir, CLI_FILE)));
  log(`${TAG} ${linkPath} resolves to ${resolved}`);
  return { kind: 'done', runtimeDir, linkPath, resolved, copied };
}

function reportRefusal(open: readonly OpenTracker[], error: (line: string) => void): void {
  error(`${TAG} REFUSED — ${open.length} plan tracker(s) still hold a task, and a loop may be running from the runtime this would replace:`);
  for (const { path, task } of open) {
    const box = task.status === 'blocked'
      ? '[BLOCKED]'
      : '[ ]';
    error(`  ${path}:${task.lineNum + 1}  ${box} ${task.task}`);
  }
  error(`${TAG} ${AFTERMATH.trackers}. Finish those plans, then run it again.`);
}

/** Runs one step, answering any throw from it as a failure at that step. */
function inStage<T>(stage: SnapshotStage, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof StageFailure) throw err;
    throw new StageFailure(stage, err instanceof Error
      ? err.message
      : String(err));
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

if (import.meta.main) {
  let code = EXIT_COULD_NOT_RUN;
  try {
    code = exitCodeFor(snapshotRuntime(defaultSeams()));
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : String(err);
    console.error(`${TAG} FAIL — ${message}`);
  }
  process.exit(code);
}
