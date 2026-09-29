/**
 * `rafa doctor` and `rafa release settle` (`src/commands/doctor-release.ts`,
 * `src/commands/release/settle.ts`), spawned as the real `rafa` binary —
 * `src/tests/cli-capture.ts` — over a bare origin, a hub clone that plays
 * the forge's own checkout, and two SEPARATE caller clones: one device
 * that only ever runs `doctor`, and another that later runs the settle.
 *
 * `release-settle-parallel-branches-spawned-cli.test.ts` already proves a
 * button-style (`--no-ff`) merge folds cleanly through settle; this file's
 * own question is the gap between the merge and that settle — the window
 * the plan's root rule leaves on purpose, where a fragment sits merged on
 * the base but no version or changelog section exists for it yet. A
 * device that clones or fetches the base in that window must be told, so
 * `rafa doctor` reads the fragment as waiting and warns naming
 * `rafa release settle`; a LATER settle, run from a clone that never saw
 * the first one's `doctor` output, still folds it the same way settle
 * always does.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { Fragment } from '../release/fragment.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-doctor-button-merge-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The manifest on `main` before the button merge. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main` before the button merge. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every commit this file writes gets, isolated from the operator's clock. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git run (branching, merging, cloning) runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A fragment's text, one note. */
function fragmentText(plan: string, level: Fragment['level'], note: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes: [`- ${note}`] });
}

/** A bare origin, the hub clone that plays the forge's own checkout, and two devices' own clones. */
interface World {
  readonly origin: string;
  /** The clone that creates `rafa-42` off `main` and merges it with `--no-ff`; plays the forge's own checkout. */
  readonly hub: string;
  /** The device that only ever runs `doctor`, cloned AFTER the button merge lands on origin. */
  readonly watcher: ScratchRepo;
  /** The device that later runs `release settle`, cloned AFTER the button merge too, but never runs `doctor` itself. */
  readonly settler: ScratchRepo;
  /** Runs git in `cwd` under the isolated environment, answering stdout and stderr trimmed and joined. */
  readonly git: (cwd: string, args: readonly string[]) => { readonly text: string; readonly exitCode: number };
}

/** Runs git in `cwd`, throwing with its combined output on a nonzero exit. */
function gitRunnerFor(home: string): { readonly git: World['git']; readonly run: (cwd: string, args: readonly string[]) => string } {
  const git = (cwd: string, args: readonly string[]): { text: string; exitCode: number } => {
    const result = Bun.spawnSync(['git', ...args], { cwd, env: isolatedEnv(home), stdout: 'pipe', stderr: 'pipe' });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    return { text: `${stdout}${stderr}`.trim(), exitCode: result.exitCode ?? 1 };
  };
  const run = (cwd: string, args: readonly string[]): string => {
    const result = git(cwd, args);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${result.text}`);
    return result.text;
  };
  return { git, run };
}

/** Clones `origin` into a fresh directory under `dir`, made a project on a `feat` branch, its own `git status` clean. */
function cloneDevice(dir: string, name: string, origin: string, run: (cwd: string, args: readonly string[]) => string): ScratchRepo {
  const repo = join(dir, name);
  const home = join(dir, `${name}-home`);
  const bin = join(dir, `${name}-bin`);
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  run(dir, ['clone', '-q', origin, repo]);
  const settings: readonly (readonly [string, string])[] = [
    ['user.name', 'rafa settle'],
    ['user.email', 'settle@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ];
  for (const [key, value] of settings) run(repo, ['config', key, value]);
  run(repo, ['switch', '-q', '-c', 'feat']);
  // `.rafa/` holds the operator's own project config and state — ignored, the
  // way a real project's own `.gitignore` keeps it, so the device's `git
  // status` reads clean around every command this file spawns.
  writeFileSync(join(repo, '.gitignore'), '.rafa/\n');
  run(repo, ['add', '-A']);
  run(repo, ['commit', '-q', '-m', 'ignore .rafa/']);
  plantProjectConfig(repo);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, bin, callLog: join(dir, `${name}-calls.log`), path: [bin, dirname(gitBinary)].join(delimiter) };
}

/**
 * Builds a {@link World}: a bare origin seeded with a manifest and a
 * changelog on `main`, a hub clone that merges `rafa-42` into `main` with
 * `git merge --no-ff --no-edit` — a merge commit on `main`, the shape a
 * forge's own "Merge pull request" button leaves, not a rebase or a
 * squash — and pushes it, BEFORE either device clones. So both devices'
 * own `origin/main` already carries the merge at clone time, with no
 * fetch needed for `watcher`'s `doctor` to read it as last fetched.
 */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const hub = join(dir, 'hub');
  mkdirSync(home, { recursive: true });
  const { git, run } = gitRunnerFor(home);

  run(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  run(dir, ['clone', '-q', origin, hub]);
  writeFileSync(join(hub, 'package.json'), MANIFEST);
  writeFileSync(join(hub, 'CHANGELOG.md'), CHANGELOG);
  run(hub, ['add', '-A']);
  run(hub, ['commit', '-q', '-m', 'first']);
  run(hub, ['push', '-q', 'origin', 'main']);

  run(hub, ['switch', '-q', '-c', 'rafa-42']);
  mkdirSync(join(hub, '.changes'), { recursive: true });
  writeFileSync(join(hub, '.changes', 'rafa-42.md'), fragmentText('rafa-42', 'patch', 'a fix from the button merge'));
  run(hub, ['add', '-A']);
  run(hub, ['commit', '-q', '-m', 'wrap-up rafa-42']);
  run(hub, ['switch', '-q', 'main']);
  const merge = git(hub, ['merge', '--no-ff', '--no-edit', 'rafa-42']);
  if (merge.exitCode !== 0) throw new Error(`button merge in ${hub} failed: ${merge.text}`);
  run(hub, ['push', '-q', 'origin', 'main']);

  const watcher = cloneDevice(dir, 'watcher', origin, run);
  const settler = cloneDevice(dir, 'settler', origin, run);
  return { origin, hub, watcher, settler, git };
}

/** Origin's `main` subject. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]).text;
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']).text;
  return listed === ''
    ? []
    : listed.split('\n');
}

describe('a button-style merge leaves a fragment waiting; doctor warns it, a later settle from another clone folds it', () => {
  it('rafa doctor on the watcher warns naming rafa release settle; rafa release settle on the settler folds rafa-42 into 0.4.1', () => {
    const w = world();

    expect(originSubject(w)).toBe('Merge branch \'rafa-42\'');
    expect(originFragments(w)).toEqual(['.changes/rafa-42.md']);

    const doctored = runRafa(w.watcher, w.watcher.repo, ['doctor']);

    expect(doctored.exitCode).toBe(0);
    const releaseLine = doctored.stdout
      .split('\n')
      .find((line) => line.startsWith('warn: Release: '));
    expect(releaseLine).toBeDefined();
    expect(releaseLine).toContain('origin/main at 0.4.0');
    expect(releaseLine).toContain('1 fragment waits (rafa-42)');
    expect(releaseLine).toContain('run rafa release settle to fold them into one version');
    // The watcher only ever ran doctor: it wrote nothing to its own checkout or to origin.
    expect(w.git(w.watcher.repo, ['status', '--porcelain']).text).toBe('');
    expect(originSubject(w)).toBe('Merge branch \'rafa-42\'');
    expect(originFragments(w)).toEqual(['.changes/rafa-42.md']);

    const settled = runRafa(w.settler, w.settler.repo, ['release', 'settle']);

    expect(settled.exitCode).toBe(0);
    expect(settled.stdout).toContain('✅ Pushed "chore: release 0.4.1"');
    expect(originSubject(w)).toBe('chore: release 0.4.1');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:package.json']).text).toContain('0.4.1');
    const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']).text;
    expect(changelog).toContain('## 0.4.1');
    expect(changelog).toContain('<!-- rafa:fragments rafa-42 -->');
    // The settler's own checkout stayed exactly as it was: settle works in a scratch worktree.
    expect(w.git(w.settler.repo, ['status', '--porcelain']).text).toBe('');
    expect(w.git(w.settler.repo, ['branch', '--show-current']).text).toBe('feat');

    // The watcher's own `origin/main` was last fetched before the settle, so
    // its next doctor still warns until it fetches — the point of the row's
    // own "as last fetched" note (`src/commands/doctor-release.ts`); once it
    // does, doctor reads no more fragments waiting and drops the warning.
    const staleDoctor = runRafa(w.watcher, w.watcher.repo, ['doctor']);
    expect(staleDoctor.stdout).toContain('1 fragment waits (rafa-42)');

    w.git(w.watcher.repo, ['fetch', '-q', 'origin', 'main']);
    const freshDoctor = runRafa(w.watcher, w.watcher.repo, ['doctor']);
    expect(freshDoctor.stdout).not.toContain('fragment waits (');
    expect(freshDoctor.stdout.split('\n').some((line) => line.startsWith('warn: Release: '))).toBe(false);
    expect(freshDoctor.stdout).toContain('Release: origin/main at 0.4.1');
    expect(freshDoctor.stdout).toContain('no fragment waits');
  });
});
