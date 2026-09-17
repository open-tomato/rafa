import type { InstallOutcome, InstallSeams } from './install.js';

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
  installRuntime,
  outcomeProblem,
  RAFA_PACKAGE_NAME,
} from './install.js';

/**
 * `installRuntime` over a planted world: a checkout, a home and its
 * `~/.rafa/bin` under one temporary directory per case, with a build
 * runner the case supplies. No case runs the real build, which opens with
 * `rm -rf dist`, and every case asserts the paths it hands over resolve
 * under its own temporary directory, so none can reach the real home.
 *
 * "Touches nothing" is read through {@link fingerprint}, and the clean
 * run asserts the same fingerprint moves, so an equality in the refusal
 * cases is a reading that could have failed. Where a case asserts a
 * tracker is not looked at, a control beside it plants the same tracker
 * where it is looked at and reads a refusal.
 *
 * The forced cases read the replacement through a planted runtime
 * directory ({@link plantRuntime}) whose files the new build does not
 * write: gone afterwards is the whole replacement, and each case that
 * forces has the same world refusing unforced beside it as its control.
 * Where a case asserts nothing was left beside the version's directory,
 * it reads the runtime root, which the staging and outgoing directories
 * would be in.
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
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-install-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

interface World {
  repoRoot: string;
  home: string;
  /** `~/.rafa/bin`, which does not exist until an install makes it. */
  binDir: string;
  /** `~/.rafa/bin/rafa`. */
  linkPath: string;
  /** `~/.bun/bin/rafa`, a link an earlier snapshot left. */
  bunLinkPath: string;
  /** Where the bun link points: an earlier runtime's `cli.js`. */
  earlierTarget: string;
  /** `~/.rafa/runtime`, holding one directory per version installed. */
  runtimeRoot: string;
  /** Where this run's version lands. */
  runtimeDir: string;
}

/** A checkout with a `package.json`, and a home whose `~/.bun/bin/rafa` points at an earlier runtime. */
function plantWorld(manifest: Record<string, unknown> = { name: RAFA_PACKAGE_NAME, version: VERSION }): World {
  const repoRoot = join(base, 'repo');
  const home = join(base, 'home');
  const binDir = join(home, '.rafa', 'bin');
  const bunLinkPath = join(home, '.bun', 'bin', 'rafa');
  const earlierTarget = join(home, '.rafa', 'runtime', '0.0.1', 'cli.js');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(dirname(bunLinkPath), { recursive: true });
  mkdirSync(dirname(earlierTarget), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), `${JSON.stringify(manifest)}\n`);
  writeFileSync(earlierTarget, 'the earlier runtime\n');
  symlinkSync(earlierTarget, bunLinkPath);
  return {
    repoRoot,
    home,
    binDir,
    linkPath: join(binDir, 'rafa'),
    bunLinkPath,
    earlierTarget,
    runtimeRoot: join(home, '.rafa', 'runtime'),
    runtimeDir: join(home, '.rafa', 'runtime', VERSION),
  };
}

function writeFile(root: string, rel: string, lines: readonly string[]): void {
  const path = join(root, rel);
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
  seams: InstallSeams;
  /** The repo root of every build the run started. */
  builds: string[];
  out: string[];
  warnings: string[];
}

/** Seams over `world`, recording builds and output, after asserting every path is under the case's own directory. */
function harness(world: World, build: (root: string) => number): Harness {
  expectUnderBase(world.repoRoot, world.home, world.binDir, world.linkPath);
  const builds: string[] = [];
  const out: string[] = [];
  const warnings: string[] = [];
  return {
    seams: {
      repoRoot: world.repoRoot,
      home: world.home,
      build: (root) => {
        builds.push(root);
        return build(root);
      },
      log: (line) => out.push(line),
      warn: (line) => warnings.push(line),
    },
    builds,
    out,
    warnings,
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

function expectDone(outcome: InstallOutcome): Extract<InstallOutcome, { kind: 'done' }> {
  if (outcome.kind !== 'done') throw new Error(`expected a done outcome, got ${JSON.stringify(outcome)}`);
  return outcome;
}

/** The tracker names of a refused outcome, or none. */
function refusedPaths(outcome: InstallOutcome): string[] {
  return outcome.kind === 'refused' && outcome.reason === 'trackers'
    ? outcome.trackers.map((tracker) => tracker.path)
    : [];
}

/** A runtime directory for {@link VERSION} holding a `cli.js` and a marker of its own. */
function plantRuntime(world: World): void {
  mkdirSync(join(world.runtimeDir, 'plan'), { recursive: true });
  writeFileSync(join(world.runtimeDir, 'cli.js'), 'the runtime in use\n');
  writeFileSync(join(world.runtimeDir, 'index-stale9999.js'), 'export const stale = 1;\n');
  writeFileSync(join(world.runtimeDir, 'plan', 'marker.txt'), 'planted\n');
}

describe('installRuntime refuses while a tracker in plan.dir has a task left', () => {
  it('refuses on an open task, building, copying and linking nothing', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-running.md', ['# Tracker', '- [x] a finished task', '- [ ] a task left']);
    // A dist an earlier build left, which a run that did not refuse could copy.
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = installRuntime(run.seams);

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'trackers',
      planDir: join(world.repoRoot, '.rafa', 'plans'),
      trackers: [{
        path: join('.rafa', 'plans', 'PLAN_TRACKER-running.md'),
        task: { task: 'a task left', lineNum: 2, status: 'unchecked' },
      }],
    });
    expect(exitCodeFor(outcome)).toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
    expect(existsSync(world.linkPath)).toBe(false);
    expect(existsSync(world.runtimeDir)).toBe(false);
    expect(outcomeProblem(outcome, world.repoRoot)).toEqual([
      'REFUSED — 1 plan tracker(s) in .rafa/plans still hold a task, and a loop may be running from the runtime this would replace:',
      `  ${join('.rafa', 'plans', 'PLAN_TRACKER-running.md')}:3  [ ] a task left`,
      'nothing was built, copied or linked. Finish those plans, then run it again.',
    ]);
  });

  it('refuses on a blocked task, building, copying and linking nothing', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER.md', ['- [x] a finished task', '- [BLOCKED] a blocked task']);
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = installRuntime(run.seams);

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'trackers',
      trackers: [{ task: { task: 'a blocked task', lineNum: 1, status: 'blocked' } }],
    });
    expect(exitCodeFor(outcome)).toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
    expect((outcomeProblem(outcome, world.repoRoot) ?? []).join('\n')).toContain('PLAN_TRACKER.md:2  [BLOCKED] a blocked task');
  });

  it('names every tracker with a task left in plan.dir, and no other file', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-open.md', ['- [ ] an open task']);
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-blocked.md', ['- [BLOCKED] a blocked task']);
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-finished.md', ['- [x] a finished task']);
    writeFile(world.repoRoot, '.rafa/plans/PLAN-open.md', ['- [ ] a plan line, which is no tracker']);
    const run = harness(world, cleanBuild);

    const outcome = installRuntime(run.seams);

    expect(refusedPaths(outcome)).toEqual([
      join('.rafa', 'plans', 'PLAN_TRACKER-blocked.md'),
      join('.rafa', 'plans', 'PLAN_TRACKER-open.md'),
    ]);
    const text = (outcomeProblem(outcome, world.repoRoot) ?? []).join('\n');
    expect(text).not.toContain('PLAN_TRACKER-finished.md');
    expect(text).not.toContain('PLAN-open.md');
    expect(run.builds).toEqual([]);
  });

  it('reads an open line inside a closed rafa block as no task, as the loop does', () => {
    const world = plantWorld();
    const tracker = '.rafa/plans/PLAN_TRACKER-blocks.md';

    // The control: the same line outside a block is a task left.
    writeFile(world.repoRoot, tracker, ['- [x] a finished task', '', '- [ ] a body line']);
    const outside = harness(world, cleanBuild);
    expect(installRuntime(outside.seams).kind).toBe('refused');
    expect(outside.builds).toEqual([]);

    writeFile(world.repoRoot, tracker, ['- [x] a finished task', '', `${FENCE}rafa:context`, '- [ ] a body line', FENCE]);
    const inside = harness(world, cleanBuild);
    const outcome = installRuntime(inside.seams);

    expect(outcome.kind).toBe('done');
    expect(inside.builds).toEqual([world.repoRoot]);
  });
});

describe('installRuntime refuses a version already installed', () => {
  it('refuses when the version directory is there, naming it and the version, building nothing', () => {
    const world = plantWorld();
    plantRuntime(world);
    // A dist an earlier build left, which a run that did not refuse could copy.
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = installRuntime(run.seams);

    expect(outcome).toEqual({ kind: 'refused', reason: 'runtime-exists', version: VERSION, runtimeDir: world.runtimeDir });
    expect(exitCodeFor(outcome)).toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
    expect(existsSync(world.linkPath)).toBe(false);
    expect(outcomeProblem(outcome, world.repoRoot)).toEqual([
      `REFUSED — ${world.runtimeDir} already holds version ${VERSION}, the version in package.json, and a loop may be running from it.`,
      'nothing was built, copied or linked. Raise the version in package.json,'
        + ' or run it again with --force to replace that directory whole.',
    ]);
  });

  it('refuses an empty version directory too, and installs when only another version is there', () => {
    const world = plantWorld();
    // The control: the runtime root holds 0.0.1 alone, and this version installs.
    expect(installRuntime(harness(world, cleanBuild).seams).kind).toBe('done');

    rmSync(world.runtimeDir, { recursive: true, force: true });
    mkdirSync(world.runtimeDir, { recursive: true });
    const run = harness(world, cleanBuild);

    expect(installRuntime(run.seams)).toMatchObject({ kind: 'refused', reason: 'runtime-exists' });
    expect(run.builds).toEqual([]);
  });

  it('names the trackers first when a tracker also has a task left', () => {
    const world = plantWorld();
    plantRuntime(world);
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-running.md', ['- [ ] a task left']);
    const run = harness(world, cleanBuild);

    expect(installRuntime(run.seams)).toMatchObject({ kind: 'refused', reason: 'trackers' });

    // The control: with the tracker finished, the same world refuses for the runtime.
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-running.md', ['- [x] a task done']);
    expect(installRuntime(harness(world, cleanBuild).seams)).toMatchObject({ kind: 'refused', reason: 'runtime-exists' });
  });
});

describe('installRuntime forced replaces the version directory whole', () => {
  it('drops every file the old build left, leaves no staging directory, and links at the new cli.js', () => {
    const world = plantWorld();
    plantRuntime(world);
    const run = harness(world, cleanBuild);

    // The control: the same world, unforced, refuses and builds nothing.
    expect(installRuntime(run.seams)).toMatchObject({ kind: 'refused', reason: 'runtime-exists' });
    expect(run.builds).toEqual([]);

    const outcome = expectDone(installRuntime(run.seams, { force: true }));

    expect(outcome.copied).toBe(Object.keys(BUILT).length);
    expect(run.builds).toEqual([world.repoRoot]);
    for (const [rel, text] of Object.entries(BUILT)) {
      expect(readFileSync(join(world.runtimeDir, rel), 'utf8'), rel).toBe(text);
    }
    expect(existsSync(join(world.runtimeDir, 'index-stale9999.js'))).toBe(false);
    expect(existsSync(join(world.runtimeDir, 'plan', 'marker.txt'))).toBe(false);
    expect(readdirSync(world.runtimeRoot).sort()).toEqual(['0.0.1', VERSION]);
    expect(statSync(join(world.runtimeDir, 'cli.js')).mode & 0o111).toBe(0o111);
    expect(realpathSync(world.linkPath)).toBe(join(world.runtimeDir, 'cli.js'));
    expect(readFileSync(world.earlierTarget, 'utf8')).toBe('the earlier runtime\n');
    expect(run.out).toContain(`copying ${join(world.repoRoot, 'dist')} over ${world.runtimeDir}, replacing it whole`);
  });

  it('installs into a version directory that is not there, saying it copied into it', () => {
    const world = plantWorld();
    const run = harness(world, cleanBuild);

    const outcome = expectDone(installRuntime(run.seams, { force: true }));

    expect(outcome.copied).toBe(Object.keys(BUILT).length);
    expect(readdirSync(world.runtimeRoot).sort()).toEqual(['0.0.1', VERSION]);
    expect(run.out).toContain(`copying ${join(world.repoRoot, 'dist')} into ${world.runtimeDir}`);
  });

  it('leaves the runtime it was replacing in place when the copy fails, with no staging directory left', () => {
    const world = plantWorld();
    plantRuntime(world);
    const run = harness(world, (root) => {
      writeDist(root);
      // An entry that is neither a file nor a directory, which the copy throws on.
      symlinkSync(join(root, 'dist', 'cli.js'), join(root, 'dist', 'linked.js'));
      return 0;
    });

    const outcome = installRuntime(run.seams, { force: true });

    expect(outcome).toMatchObject({ kind: 'failed', stage: 'copy' });
    expect(outcomeProblem(outcome, world.repoRoot)?.[0]).toContain('is neither a file nor a directory');
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(readFileSync(join(world.runtimeDir, 'cli.js'), 'utf8')).toBe('the runtime in use\n');
    expect(readFileSync(join(world.runtimeDir, 'plan', 'marker.txt'), 'utf8')).toBe('planted\n');
    expect(readdirSync(world.runtimeRoot).sort()).toEqual(['0.0.1', VERSION]);
    expect(existsSync(world.linkPath)).toBe(false);
    expect(outcomeProblem(outcome, world.repoRoot)?.[1])
      .toBe('the runtime directory holds the build it held or this one, never a mix, and the link was not changed.');
  });
});

describe('where installRuntime looks for trackers', () => {
  it('looks in the plan.dir the project config names, and not in the default beside it', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.plans/PLAN_TRACKER-a.md', ['- [ ] an open task in .plans']);

    // The control: with no config, plan.dir is .rafa/plans, and a tracker in .plans is not looked at.
    const unconfigured = harness(world, cleanBuild);
    expect(installRuntime(unconfigured.seams).kind).toBe('done');

    writeFile(world.repoRoot, '.rafa/config.yaml', ['plan:', '  dir: .plans']);
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-b.md', ['- [ ] an open task in the default']);
    const configured = harness(world, cleanBuild);
    const outcome = installRuntime(configured.seams);

    expect(outcome).toMatchObject({ kind: 'refused', planDir: join(world.repoRoot, '.plans') });
    expect(refusedPaths(outcome)).toEqual([join('.plans', 'PLAN_TRACKER-a.md')]);
    expect(configured.builds).toEqual([]);
    expect(configured.out).toContain(`plan dir: ${join(world.repoRoot, '.plans')}`);
  });

  it('reads plan.dir from the user scope of the home it is handed', () => {
    const world = plantWorld();
    writeFile(world.home, '.rafa/config.yaml', ['plan:', '  dir: user-plans']);
    writeFile(world.repoRoot, 'user-plans/PLAN_TRACKER-u.md', ['- [ ] an open task']);
    const run = harness(world, cleanBuild);

    const outcome = installRuntime(run.seams);

    expect(refusedPaths(outcome)).toEqual([join('user-plans', 'PLAN_TRACKER-u.md')]);
  });

  it('does not look at the repo root or inside a subdirectory of plan.dir', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, 'PLAN_TRACKER.md', ['- [ ] an open task at the root']);
    writeFile(world.repoRoot, '.rafa/plans/archive/PLAN_TRACKER-old.md', ['- [ ] an open task below plan.dir']);
    const run = harness(world, cleanBuild);

    expect(installRuntime(run.seams).kind).toBe('done');

    // The control: the same tracker directly in plan.dir refuses.
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-old.md', ['- [ ] an open task below plan.dir']);
    expect(refusedPaths(installRuntime(harness(world, cleanBuild).seams))).toEqual([join('.rafa', 'plans', 'PLAN_TRACKER-old.md')]);
  });
});

describe('installRuntime could not run before building', () => {
  /** Asserts the run failed at `stage` before any build, exiting 2, with nothing under the case touched. */
  function expectEarlyFailure(outcome: InstallOutcome, run: Harness, stage: string, before: string[]): void {
    expect(outcome).toMatchObject({ kind: 'failed', stage });
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(run.builds).toEqual([]);
    expect(fingerprint(base)).toEqual(before);
  }

  it('exits 2 on a package.json naming another package, touching nothing', () => {
    const world = plantWorld({ name: '@someone/else', version: VERSION });
    writeDist(world.repoRoot);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = installRuntime(run.seams);

    expectEarlyFailure(outcome, run, 'manifest', before);
    expect(outcomeProblem(outcome, world.repoRoot)?.[0]).toContain('names "@someone/else", not @open-tomato/rafa');
  });

  it('exits 2 on a version that could climb out of the runtime root, touching nothing', () => {
    const world = plantWorld({ name: RAFA_PACKAGE_NAME, version: '../../escape' });
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    expectEarlyFailure(installRuntime(run.seams), run, 'manifest', before);
  });

  it('exits 2 on a config it refuses, touching nothing', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/config.yaml', ['plan:', '  dir: 7']);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    expectEarlyFailure(installRuntime(run.seams), run, 'config', before);
  });

  it('exits 2 when plan.dir cannot be read, touching nothing', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/plans', ['a file where the directory belongs']);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = installRuntime(run.seams);

    expectEarlyFailure(outcome, run, 'trackers', before);
    expect(outcomeProblem(outcome, world.repoRoot)?.[1]).toBe('nothing was built, copied or linked.');
  });
});

describe('a failed build copies and links nothing', () => {
  /** Asserts the run failed at the build, exiting 2 and never 1, with the home untouched. */
  function expectBuildFailure(world: World, run: Harness, outcome: InstallOutcome, homeBefore: string[]): void {
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'build' });
    expect(exitCodeFor(outcome)).toBe(EXIT_COULD_NOT_RUN);
    expect(exitCodeFor(outcome)).not.toBe(EXIT_REFUSED);
    expect(run.builds).toEqual([world.repoRoot]);
    expect(fingerprint(world.home)).toEqual(homeBefore);
    expect(existsSync(world.runtimeDir)).toBe(false);
    expect(existsSync(world.linkPath)).toBe(false);
  }

  it('fails when the build exits nonzero after writing dist', () => {
    const world = plantWorld();
    const run = harness(world, (root) => {
      writeDist(root);
      return 1;
    });
    const homeBefore = fingerprint(world.home);

    const outcome = installRuntime(run.seams);

    expectBuildFailure(world, run, outcome, homeBefore);
    expect(outcome).toMatchObject({ message: 'the build exited 1' });
    expect(outcomeProblem(outcome, world.repoRoot)).toEqual(['FAIL — build: the build exited 1', 'nothing was copied or linked.']);
  });

  it('fails when the build runner throws', () => {
    const world = plantWorld();
    const run = harness(world, () => {
      throw new Error('bun could not be spawned');
    });
    const homeBefore = fingerprint(world.home);

    const outcome = installRuntime(run.seams);

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

    expectBuildFailure(world, run, installRuntime(run.seams), homeBefore);
  });
});

describe('a clean run', () => {
  it('lands cli.js under the runtime directory with ~/.rafa/bin/rafa resolving to it, leaving ~/.bun/bin/rafa alone', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/plans/PLAN_TRACKER-finished.md', ['- [x] a finished task', '- [x] another']);
    const run = harness(world, cleanBuild);
    const before = fingerprint(base);

    const outcome = expectDone(installRuntime(run.seams));

    const cli = join(world.runtimeDir, 'cli.js');
    expect(outcome).toEqual({
      kind: 'done',
      version: VERSION,
      runtimeDir: world.runtimeDir,
      linkPath: world.linkPath,
      resolved: cli,
      copied: Object.keys(BUILT).length,
    });
    expectUnderBase(outcome.runtimeDir, outcome.linkPath, outcome.resolved);
    expect(exitCodeFor(outcome)).toBe(EXIT_DONE);
    expect(outcomeProblem(outcome, world.repoRoot)).toBeNull();
    expect(run.builds).toEqual([world.repoRoot]);

    for (const [rel, text] of Object.entries(BUILT)) {
      expect(readFileSync(join(world.runtimeDir, rel), 'utf8'), rel).toBe(text);
    }
    expect(statSync(cli).mode & 0o111).toBe(0o111);

    expect(lstatSync(world.linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(world.linkPath)).toBe(cli);
    expect(realpathSync(world.linkPath)).toBe(cli);
    expect(readlinkSync(world.bunLinkPath)).toBe(world.earlierTarget);
    expect(readFileSync(world.earlierTarget, 'utf8')).toBe('the earlier runtime\n');

    expect(readdirSync(world.binDir)).toEqual(['rafa']);
    expect(readdirSync(world.runtimeDir).filter((name) => name.includes('.snapshot-'))).toEqual([]);
    expect(readdirSync(world.runtimeRoot).sort()).toEqual(['0.0.1', VERSION]);
    expect(run.out.at(-1)).toBe(`${world.linkPath} resolves to ${cli}`);
    expect(run.warnings).toEqual([]);

    // The control the refusal cases lean on: this fingerprint sees a copy and a link.
    expect(fingerprint(base)).not.toEqual(before);
  });

  it('renames a new link over one an earlier install left', () => {
    const world = plantWorld();
    mkdirSync(world.binDir, { recursive: true });
    symlinkSync(world.earlierTarget, world.linkPath);
    const run = harness(world, cleanBuild);

    const outcome = expectDone(installRuntime(run.seams));

    expect(readlinkSync(world.linkPath)).toBe(join(world.runtimeDir, 'cli.js'));
    expect(outcome.resolved).toBe(join(world.runtimeDir, 'cli.js'));
    expect(readdirSync(world.binDir)).toEqual(['rafa']);
  });

  it('passes a config warning to warn, and still installs', () => {
    const world = plantWorld();
    writeFile(world.repoRoot, '.rafa/config.yaml', ['nonesuch: 1']);
    const run = harness(world, cleanBuild);

    expect(installRuntime(run.seams).kind).toBe('done');
    expect(run.warnings.join('\n')).toContain('nonesuch');
  });
});
