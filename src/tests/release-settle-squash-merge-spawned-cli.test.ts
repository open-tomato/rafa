/**
 * `rafa release settle` (`src/commands/release/settle.ts`), spawned as
 * the real `rafa` binary — `src/tests/cli-capture.ts` — over a fragment a
 * SQUASH merge carries to `main`: `git merge --squash <branch>` stages the
 * branch's changes with no merge commit and no parent but `main`'s own
 * tip, then a plain `git commit` lands them as one ordinary commit (the
 * shape a forge's "Squash and merge" button leaves).
 *
 * `release-settle-parallel-branches-spawned-cli.test.ts` and
 * `release-settle-doctor-button-merge-spawned-cli.test.ts` already cover a
 * `--no-ff` button merge; this file's own question is disjoint from both —
 * `fragment-tree.ts`'s module note says a squash merge is ITSELF the
 * first-parent commit that adds the fragment, with no merge commit to
 * credit instead, so the first settle must read that squash commit as the
 * add and fold the fragment once; a SECOND settle run afterward, with
 * nothing new landed on the base, must find nothing waiting and change
 * nothing — proving the fold ran exactly once across the two runs, not
 * once per run.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { Fragment } from '../release/fragment.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-squash-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The manifest on `main` before the squash merge. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main` before the squash merge. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every commit this file writes gets, isolated from the operator's clock. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git run (branching, squashing, cloning) runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A fragment's text, one note. */
function fragmentText(plan: string, level: Fragment['level'], note: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes: [`- ${note}`] });
}

/** A bare origin, the hub clone that squash-merges the branch, and the caller's own clone. */
interface World {
  readonly origin: string;
  /** The caller's clone, both spawned `rafa release settle` runs are spawned from here. */
  readonly scratch: ScratchRepo;
  /** The clone that creates `rafa-19` off `main` and squash-merges it; plays the forge's own checkout. */
  readonly hub: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout and stderr trimmed and joined. */
  readonly git: (cwd: string, args: readonly string[]) => { readonly text: string; readonly exitCode: number };
}

/**
 * Builds a {@link World}: a bare origin seeded with a manifest and a
 * changelog on `main`, a hub clone that squash-merges `rafa-19` into
 * `main` with `git merge --squash` followed by a plain `git commit` — one
 * ordinary commit whose only parent is `main`'s own prior tip, no merge
 * commit at all — and pushes it, before the caller ever clones.
 */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const origin = join(dir, 'origin.git');
  const hub = join(dir, 'hub');
  const caller = join(dir, 'caller');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): { text: string; exitCode: number } => {
    const run = Bun.spawnSync(['git', ...args], { cwd, env: isolatedEnv(home), stdout: 'pipe', stderr: 'pipe' });
    const stdout = new TextDecoder().decode(run.stdout);
    const stderr = new TextDecoder().decode(run.stderr);
    return { text: `${stdout}${stderr}`.trim(), exitCode: run.exitCode ?? 1 };
  };
  const run = (cwd: string, args: readonly string[]): string => {
    const result = git(cwd, args);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${result.text}`);
    return result.text;
  };

  run(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  run(dir, ['clone', '-q', origin, hub]);
  writeFileSync(join(hub, 'package.json'), MANIFEST);
  writeFileSync(join(hub, 'CHANGELOG.md'), CHANGELOG);
  run(hub, ['add', '-A']);
  run(hub, ['commit', '-q', '-m', 'first']);
  run(hub, ['push', '-q', 'origin', 'main']);

  run(hub, ['switch', '-q', '-c', 'rafa-19']);
  mkdirSync(join(hub, '.changes'), { recursive: true });
  writeFileSync(join(hub, '.changes', 'rafa-19.md'), fragmentText('rafa-19', 'minor', 'a squashed feature'));
  run(hub, ['add', '-A']);
  run(hub, ['commit', '-q', '-m', 'wrap-up rafa-19']);
  run(hub, ['switch', '-q', 'main']);
  const squash = git(hub, ['merge', '--squash', 'rafa-19']);
  if (squash.exitCode !== 0) throw new Error(`squash merge in ${hub} failed: ${squash.text}`);
  // `--squash` stages the change but writes no commit and no merge parent:
  // this commit is `main`'s tip's ONLY new commit, with `main`'s own prior
  // tip as its sole parent, the shape a forge's "Squash and merge" leaves.
  run(hub, ['commit', '-q', '-m', 'squash merge rafa-19']);
  run(hub, ['push', '-q', 'origin', 'main']);

  run(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [
    ['user.name', 'rafa settle'],
    ['user.email', 'settle@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ];
  for (const [key, value] of settings) run(caller, ['config', key, value]);
  run(caller, ['switch', '-q', '-c', 'feat']);
  // `.rafa/` holds the operator's own project config and state — ignored, the
  // way a real project's own `.gitignore` keeps it, so the caller's `git
  // status` reads clean around every command this file spawns.
  writeFileSync(join(caller, '.gitignore'), '.rafa/\n');
  run(caller, ['add', '-A']);
  run(caller, ['commit', '-q', '-m', 'ignore .rafa/']);
  plantProjectConfig(caller);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const scratch: ScratchRepo = { repo: caller, home, bin, callLog: join(dir, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
  return { origin, scratch, hub, git };
}

/** Origin's `main` subject. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]).text;
}

/** Origin's `main` tip commit hash. */
function originHead(w: World, ref = 'main'): string {
  return w.git(w.origin, ['rev-parse', ref]).text;
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']).text;
  return listed === ''
    ? []
    : listed.split('\n');
}

describe('rafa release settle, a fragment a squash merge carried to main', () => {
  it('the squash commit is the fragment\'s own add; one settle folds it, a second finds nothing waiting and changes nothing', () => {
    const w = world();

    // The squash left no merge commit: `main`'s tip is one ordinary commit
    // with a single parent, not a "Merge branch" subject.
    expect(originSubject(w)).toBe('squash merge rafa-19');
    expect(w.git(w.origin, ['rev-list', '--count', '--first-parent', 'main']).text).toBe('2');
    expect(originFragments(w)).toEqual(['.changes/rafa-19.md']);

    const firstSettle = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    expect(firstSettle.exitCode).toBe(0);
    expect(firstSettle.stdout).toContain('1. .changes/rafa-19.md — minor, "title of rafa-19"');
    expect(firstSettle.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:package.json']).text).toContain('0.5.0');
    const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']).text;
    expect(changelog).toContain('## 0.5.0');
    expect(changelog).toContain('<!-- rafa:fragments rafa-19 -->');
    const settledHead = originHead(w);

    const secondSettle = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    // Nothing is waiting a second time: the fold ran exactly once across
    // the two runs, and the second neither writes nor pushes anything.
    expect(secondSettle.exitCode).toBe(0);
    expect(secondSettle.stdout).toContain('Fragments: none waiting');
    expect(secondSettle.stdout).toContain('Nothing to settle: no fragment waits that ships a release.');
    expect(secondSettle.stdout).not.toContain('Pushed');
    expect(originHead(w)).toBe(settledHead);
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:package.json']).text).toContain('0.5.0');

    // The caller's own checkout stayed exactly as it was across both runs:
    // settle always works in a scratch worktree.
    expect(w.git(w.scratch.repo, ['status', '--porcelain']).text).toBe('');
    expect(w.git(w.scratch.repo, ['branch', '--show-current']).text).toBe('feat');
  });
});
