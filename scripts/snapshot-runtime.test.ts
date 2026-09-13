import type { SnapshotOutcome, SnapshotSeams } from './snapshot-runtime.js';

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  EXIT_COULD_NOT_RUN,
  EXIT_DONE,
  EXIT_REFUSED,
  exitCodeFor,
  snapshotRuntime,
} from './snapshot-runtime.js';

/**
 * `snapshotRuntime` over a planted world: a repo root, a home and a bin
 * directory under one temporary directory per case, with a build runner
 * the case supplies. No case runs the real build, which opens with
 * `rm -rf dist`, and every case asserts the paths it hands over resolve
 * under its own temporary directory, so none can reach the real home.
 *
 * "Touches nothing" is read through {@link fingerprint}, and the clean
 * run asserts the same fingerprint moves, so an equality in the refusal
 * cases is a reading that could have failed.
 */

const FENCE = '```';
const VERSION = '9.8.7';

/** What a planted build writes into `dist/`, a nested file among it. */
const BUILT: Readonly<Record<string, string>> = {
  'cli.js': '#!/usr/bin/env bun\nconsole.log(1);\n',
  'PROMPT.md': 'the new prompt\n',
  'index-new1234.js': 'export const chunk = 1;\n',
  'plan/index.js': 'export const plan = 1;\n',
};

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-snapshot-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

interface World {
  repoRoot: string;
  home: string;
  binDir: string;
  linkPath: string;
  /** Where the link points before a run: an earlier runtime's `cli.js`. */
  earlierTarget: string;
  /** Where this run's version lands. */
  runtimeDir: string;
}

/** A repo root with a `package.json`, and a home whose link points at an earlier runtime. */
function plantWorld(version: string = VERSION): World {
  const repoRoot = join(base, 'repo');
  const home = join(base, 'home');
  const binDir = join(home, '.bun', 'bin');
  const linkPath = join(binDir, 'rafa');
  const earlierTarget = join(home, '.rafa', 'runtime', '0.0.1', 'cli.js');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dirname(earlierTarget), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'fixture', version })}\n`);
  writeFileSync(earlierTarget, 'the earlier runtime\n');
  symlinkSync(earlierTarget, linkPath);
  return {
    repoRoot,
    home,
    binDir,
    linkPath,
    earlierTarget,
    runtimeDir: join(home, '.rafa', 'runtime', VERSION),
  };
}

function writeTracker(world: World, rel: string, lines: readonly string[]): void {
  const path = join(world.repoRoot, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}

/** Writes {@link BUILT} into `root`'s `dist/`, `cli.js` executable as the real build leaves it. */
function writeDist(root: string): void {
  for (const [rel, text] of Object.entries(BUILT)) {
    const path = join(root, 'dist', rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  chmodSync(join(root, 'dist', 'cli.js'), 0o755);
}

/** A build that writes `dist/` and exits 0, as a clean `bun run build` does. */
function cleanBuild(root: string): number {
  writeDist(root);
  return 0;
}

function expectUnderBase(...paths: string[]): void {
  for (const path of paths) expect(path.startsWith(`${base}${sep}`), path).toBe(true);
}

interface Harness {
  seams: SnapshotSeams;
  /** The repo root of every build the run started. */
  builds: string[];
  out: string[];
  err: string[];
}

/** Seams over `world`, recording builds and output, after asserting every path is under the case's own directory. */
function harness(world: World, build: (root: string) => number): Harness {
  expectUnderBase(world.repoRoot, world.home, world.binDir);
  const builds: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  return {
    seams: {
      repoRoot: world.repoRoot,
      home: world.home,
      binDir: world.binDir,
      build: (root) => {
        builds.push(root);
        return build(root);
      },
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    },
    builds,
    out,
    err,
  };
}

/**
 * Every entry under `root`, depth first, with its inode, mode,
 * modification time and content or link target. Reading a file changes
 * none of these; writing a file, renaming one over another, creating a
 * directory or swapping a link changes at least one.
 */
function fingerprint(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      const stat = lstatSync(path);
      const head = `${relative(base, path)} ino=${stat.ino} mode=${stat.mode.toString(8)} mtime=${stat.mtimeMs}`;
      if (entry.isSymbolicLink()) return [`${head} -> ${readlinkSync(path)}`];
      if (entry.isDirectory()) return [head, ...fingerprint(path)];
      return [`${head} ${readFileSync(path, 'utf8')}`];
    });
}

function expectDone(outcome: SnapshotOutcome): Extract<SnapshotOutcome, { kind: 'done' }> {
  if (outcome.kind !== 'done') throw new Error(`expected a done outcome, got ${JSON.stringify(outcome)}`);
  return outcome;
}

describe('snapshotRuntime refuses while a tracker has a task left', () => {
  it('refuses on an open task, building, copying and relinking nothing', () => {
    const world = plantWorld();
    writeTracker(world, '.plans/PLAN_TRACKER-running.md', ['# Tracker', '- [x] a finished task', '- [ ] a task left']);
    // A dist an earlier build left, which a run that did not refuse could copy.
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = snapshotRuntime(run.seams);

    expect(outcome).toEqual({
      kind: 'refused',
      trackers: [{
        path: join('.plans', 'PLAN_TRACKER-running.md'),
        task: { task: 'a task left', lineNum: 2, status: 'unchecked' },
      }],
    });
    expect(exitCodeFor(outcome)).toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
    expect(readlinkSync(world.linkPath)).toBe(world.earlierTarget);
    expect(existsSync(world.runtimeDir)).toBe(false);
    expect(run.err.join('\n')).toContain(join('.plans', 'PLAN_TRACKER-running.md'));
  });

  it('refuses on a blocked task, building, copying and relinking nothing', () => {
    const world = plantWorld();
    writeTracker(world, 'PLAN_TRACKER.md', ['- [x] a finished task', '- [BLOCKED] a blocked task']);
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = snapshotRuntime(run.seams);

    expect(outcome).toEqual({
      kind: 'refused',
      trackers: [{
        path: 'PLAN_TRACKER.md',
        task: { task: 'a blocked task', lineNum: 1, status: 'blocked' },
      }],
    });
    expect(exitCodeFor(outcome)).toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
    expect(readlinkSync(world.linkPath)).toBe(world.earlierTarget);
    expect(run.err.join('\n')).toContain('PLAN_TRACKER.md:2  [BLOCKED] a blocked task');
  });

  it('names every tracker with a task left, in .plans and at the repo root, and no other file', () => {
    const world = plantWorld();
    writeTracker(world, '.plans/PLAN_TRACKER-open.md', ['- [ ] an open task']);
    writeTracker(world, '.plans/PLAN_TRACKER-finished.md', ['- [x] a finished task']);
    writeTracker(world, '.plans/PLAN-open.md', ['- [ ] a plan line, which is no tracker']);
    writeTracker(world, 'PLAN_TRACKER-root.md', ['- [BLOCKED] a blocked task']);
    const run = harness(world, cleanBuild);

    const outcome = snapshotRuntime(run.seams);

    expect(outcome.kind).toBe('refused');
    const named = outcome.kind === 'refused'
      ? outcome.trackers.map((tracker) => tracker.path)
      : [];
    expect(named).toEqual([join('.plans', 'PLAN_TRACKER-open.md'), 'PLAN_TRACKER-root.md']);
    const text = run.err.join('\n');
    expect(text).toContain(join('.plans', 'PLAN_TRACKER-open.md'));
    expect(text).toContain('PLAN_TRACKER-root.md');
    expect(text).not.toContain('PLAN_TRACKER-finished.md');
    expect(text).not.toContain('PLAN-open.md');
    expect(run.builds).toEqual([]);
  });

  it('reads an open line inside a closed rafa block as no task, as the loop does', () => {
    const world = plantWorld();
    const tracker = '.plans/PLAN_TRACKER-blocks.md';

    // The control: the same line outside a block is a task left.
    writeTracker(world, tracker, ['- [x] a finished task', '', '- [ ] a body line']);
    const outside = harness(world, cleanBuild);
    expect(snapshotRuntime(outside.seams).kind).toBe('refused');
    expect(outside.builds).toEqual([]);

    writeTracker(world, tracker, ['- [x] a finished task', '', `${FENCE}rafa:context`, '- [ ] a body line', FENCE]);
    const inside = harness(world, cleanBuild);
    const outcome = snapshotRuntime(inside.seams);

    expect(outcome.kind).toBe('done');
    expect(inside.builds).toEqual([world.repoRoot]);
  });
});

describe('snapshotRuntime could not run before building', () => {
  it('exits 2 when a tracker directory cannot be read, touching nothing', () => {
    const world = plantWorld();
    writeFileSync(join(world.repoRoot, '.plans'), 'a file where the directory belongs\n');
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = snapshotRuntime(run.seams);

    expect(outcome).toMatchObject({ kind: 'failed', stage: 'trackers' });
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
  });

  it('exits 2 on a version that could climb out of the runtime root, touching nothing', () => {
    const world = plantWorld('../../escape');
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = snapshotRuntime(run.seams);

    expect(outcome).toMatchObject({ kind: 'failed', stage: 'version' });
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
  });
});

describe('a failed build copies and relinks nothing', () => {
  /** Asserts the run failed at the build, exiting 2 and never 1, with the home untouched. */
  function expectBuildFailure(world: World, run: Harness, outcome: SnapshotOutcome, homeBefore: string[]): void {
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'build' });
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(exitCodeFor(outcome)).not.toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([world.repoRoot]);
    expect(fingerprint(world.home)).toEqual(homeBefore);
    expect(existsSync(world.runtimeDir)).toBe(false);
    expect(readlinkSync(world.linkPath)).toBe(world.earlierTarget);
  }

  it('fails when the build exits nonzero after writing dist', () => {
    const world = plantWorld();
    const run = harness(world, (root) => {
      writeDist(root);
      return 1;
    });
    const homeBefore = fingerprint(world.home);

    const outcome = snapshotRuntime(run.seams);

    expectBuildFailure(world, run, outcome, homeBefore);
    expect(outcome).toMatchObject({ message: 'the build exited 1' });
  });

  it('fails when the build runner throws', () => {
    const world = plantWorld();
    const run = harness(world, () => {
      throw new Error('bun could not be spawned');
    });
    const homeBefore = fingerprint(world.home);

    const outcome = snapshotRuntime(run.seams);

    expectBuildFailure(world, run, outcome, homeBefore);
    expect(outcome).toMatchObject({ message: 'bun could not be spawned' });
  });

  it('fails when the build exits 0 and leaves no cli.js', () => {
    const world = plantWorld();
    const run = harness(world, (root) => {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist', 'PROMPT.md'), 'a prompt with no runner beside it\n');
      return 0;
    });
    const homeBefore = fingerprint(world.home);

    const outcome = snapshotRuntime(run.seams);

    expectBuildFailure(world, run, outcome, homeBefore);
  });
});

describe('a clean run', () => {
  it('lands cli.js under the runtime directory with the link resolving to it', () => {
    const world = plantWorld();
    writeTracker(world, '.plans/PLAN_TRACKER-finished.md', ['- [x] a finished task', '- [x] another']);
    // The version's directory usually exists already.
    mkdirSync(world.runtimeDir, { recursive: true });
    writeFileSync(join(world.runtimeDir, 'cli.js'), 'the runtime being replaced\n');
    writeFileSync(join(world.runtimeDir, 'index-stale9999.js'), 'export const stale = 1;\n');
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = expectDone(snapshotRuntime(run.seams));

    const cli = join(world.runtimeDir, 'cli.js');
    expect(outcome).toEqual({
      kind: 'done',
      runtimeDir: world.runtimeDir,
      linkPath: world.linkPath,
      resolved: cli,
      copied: Object.keys(BUILT).length,
    });
    expectUnderBase(outcome.runtimeDir, outcome.linkPath, outcome.resolved);
    expect(exitCodeFor(outcome)).toBe(EXIT_DONE);
    expect(run.builds).toEqual([world.repoRoot]);

    for (const [rel, text] of Object.entries(BUILT)) {
      expect(readFileSync(join(world.runtimeDir, rel), 'utf8'), rel).toBe(text);
    }
    expect(statSync(cli).mode & 0o111).toBe(0o111);
    expect(readFileSync(join(world.runtimeDir, 'index-stale9999.js'), 'utf8')).toBe('export const stale = 1;\n');

    expect(lstatSync(world.linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(world.linkPath)).toBe(cli);
    expect(realpathSync(world.linkPath)).toBe(cli);
    expect(readFileSync(world.earlierTarget, 'utf8')).toBe('the earlier runtime\n');

    expect(readdirSync(world.binDir)).toEqual(['rafa']);
    expect(readdirSync(world.runtimeDir).filter((name) => name.includes('.snapshot-'))).toEqual([]);
    expect(run.out.at(-1)).toBe(`[snapshot] ${world.linkPath} resolves to ${cli}`);
    expect(run.err).toEqual([]);

    // The control the refusal cases lean on: this fingerprint sees a copy and a relink.
    expect(fingerprint(base)).not.toEqual(before);
  });

  it('creates the link when none exists yet', () => {
    const world = plantWorld();
    rmSync(world.linkPath);
    const run = harness(world, cleanBuild);

    const outcome = expectDone(snapshotRuntime(run.seams));

    expect(realpathSync(world.linkPath)).toBe(join(world.runtimeDir, 'cli.js'));
    expect(outcome.resolved).toBe(join(world.runtimeDir, 'cli.js'));
    expect(readdirSync(world.binDir)).toEqual(['rafa']);
  });
});
