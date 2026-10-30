/**
 * Integration tests for `release.moveLock` over `runSettle`
 * (`./settle.ts`), dispatched as `rafa release settle` in a project
 * whose `.rafa/config.yaml` turns the key on: a bare origin, a clone
 * that lands fragments on `main`, and the caller's clone as the project.
 *
 * The refusals come first, each read off origin's own state rather than
 * the command's word: a lock in a format this rafa does not read, and a
 * `package.json` that names another package, both exit 1 with `main`,
 * the fragments and `rafa/release` exactly as they were. Then the key
 * absent, which leaves a lock byte-identical in the release commit; and
 * the two deliveries, each putting one commit holding the new version in
 * `package.json`, the changelog section and `rafa.lock` at that version.
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { PullRequestDraft, PullRequestSummary } from '@open-tomato/rafa/pr/types';
import type { ReleaseSettleSeams } from '@open-tomato/rafa-release/commands/release/settle';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { serializeFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { createReleaseSettleCommand } from '@open-tomato/rafa-release/commands/release/settle';
import { projectLockText } from '@open-tomato/rafa-release/project/lock';

import { projectConfigText } from '../../../../project/scaffold.js';
import { dispatchInProject, plantProjectConfig } from '../../../cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-lock-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The one subject the dispatch cases register. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** A remote `resolvePrProvider` reads as GitHub. */
const GITHUB_REMOTE = 'https://github.com/open-tomato/demo.git';

/** The config lines that turn the key on. */
const KEY_ON = 'release:\n  moveLock: true\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The package name rafa's own manifest carries, which the key demands. */
const RAFA_NAME = '@open-tomato/rafa';

/** A manifest at 0.4.0 naming `name`. */
function manifest(name: string): string {
  return `{\n\t"name": "${name}",\n\t"version": "0.4.0"\n}\n`;
}

/** What the base branch holds at the start of a world. */
interface Base {
  /** The manifest's `name`. */
  readonly name: string;
  /** The lock's text on `main`, or null for none. */
  readonly lock: string | null;
  /** Extra lines appended to the caller's `.rafa/config.yaml`. */
  readonly config: string;
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone as a project. */
interface World {
  readonly origin: string;
  readonly project: PlantedProject;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
}

/** The environment every setup git runs under, isolated from the operator's config. */
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

/** A fragment's text. */
function fragmentText(plan: string, level: 'minor' | 'patch'): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, package: null, notes: ['- Loop: a line'] });
}

/**
 * Builds a {@link World} over `base`, with `rafa-9` (minor) and then
 * `rafa-1` (patch) landed on `main`, so a settle folds 0.4.0 to 0.5.0.
 */
function world(base: Base): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commitAll = (message: string): void => {
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), manifest(base.name));
  writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  if (base.lock !== null) writeFileSync(join(other, 'rafa.lock'), base.lock);
  commitAll('first');
  for (const [plan, level] of [['rafa-9', 'minor'], ['rafa-1', 'patch']] as const) {
    mkdirSync(join(other, '.changes'), { recursive: true });
    writeFileSync(join(other, '.changes', `${plan}.md`), fragmentText(plan, level));
    commitAll(`merge ${plan}`);
  }

  git(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]];
  for (const [key, value] of settings) git(caller, ['config', key, value]);
  plantProjectConfig(caller, `${projectConfigText()}${base.config}`);
  return { origin, project: { root: caller, home }, scratchRoot, git };
}

/** Dispatches `rafa release settle` in the world's caller. */
async function settle(
  w: World,
  seams: ReleaseSettleSeams = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const command: RafaCommand = createReleaseSettleCommand({ scratchRoot: w.scratchRoot, ...seams });
  return dispatchInProject(['release', 'settle'], SUBJECTS, [command], w.project);
}

/** A double with no release pull request open, opening #12. */
function opening(): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({
    findOpen: () => Promise.resolve(null),
    create: (draft: PullRequestDraft) => Promise.resolve({
      number: 12,
      title: draft.title,
      url: 'https://github.com/open-tomato/demo/pull/12',
      state: 'open',
      headRefName: draft.head,
      baseRefName: draft.base,
      author: { login: 'rafa', isBot: false },
      isCrossRepository: false,
      updatedAt: SETUP_DATE,
    } satisfies PullRequestSummary),
  });
}

/** Origin's refs, as `git for-each-ref` names them with their hashes. */
function originRefs(w: World): string {
  return w.git(w.origin, ['for-each-ref', '--format=%(refname) %(objectname)']);
}

/** The file names a commit changed, as `git show` lists them. */
function changedIn(w: World, ref: string): string[] {
  return w.git(w.origin, ['show', '--name-only', '--format=', ref]).split('\n')
    .sort();
}

/** The lock text at version `version`. */
const lockAt = projectLockText;

describe('release.moveLock, the refusals', () => {
  it('exits 1 naming rafa.lock for a lock in an unknown format, with origin exactly as it was', async () => {
    const unknown = '{\n  "lockfileVersion": 99,\n  "rafa": "0.4.0"\n}\n';
    const w = world({ name: RAFA_NAME, lock: unknown, config: KEY_ON });
    const before = originRefs(w);
    const status = w.git(w.project.root, ['status', '--porcelain']);

    const run = await settle(w);

    expect(run.exitCode).toBe(1);
    expect(run.stderr + run.stdout).toContain('rafa.lock is in lockfileVersion 99');
    expect(originRefs(w)).toBe(before);
    expect(w.git(w.origin, ['show', 'main:rafa.lock'])).toBe(unknown.trim());
    expect(w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']).split('\n')).toHaveLength(2);
    expect(w.git(w.project.root, ['status', '--porcelain'])).toBe(status);
  });

  it('exits 1 naming release.moveLock for a package.json named demo, with origin exactly as it was', async () => {
    const w = world({ name: 'demo', lock: lockAt('0.4.0'), config: KEY_ON });
    const before = originRefs(w);
    const status = w.git(w.project.root, ['status', '--porcelain']);

    const run = await settle(w);

    expect(run.exitCode).toBe(1);
    expect(run.stderr + run.stdout).toContain('release.moveLock');
    expect(run.stderr + run.stdout).toContain('demo');
    expect(originRefs(w)).toBe(before);
    expect(w.git(w.origin, ['show', 'main:rafa.lock'])).toBe(lockAt('0.4.0').trim());
    expect(w.git(w.project.root, ['status', '--porcelain'])).toBe(status);
  });

  it('control: the same world with a lock rafa reads and rafa\'s own name is settled', async () => {
    const w = world({ name: RAFA_NAME, lock: lockAt('0.4.0'), config: KEY_ON });

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
  });
});

describe('release.moveLock absent', () => {
  it('leaves rafa.lock byte-identical in the release commit, and prints no Lock: line', async () => {
    const held = lockAt('0.4.0');
    const w = world({ name: RAFA_NAME, lock: held, config: '' });

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'main'])).toBe('chore: release 0.5.0');
    expect(w.git(w.origin, ['rev-parse', 'main:rafa.lock'])).toBe(w.git(w.origin, ['rev-parse', 'main~1:rafa.lock']));
    expect(w.git(w.origin, ['show', 'main:rafa.lock'])).toBe(held.trim());
    expect(changedIn(w, 'main')).not.toContain('rafa.lock');
    expect(run.stdout).not.toContain('Lock:');
  });
});

describe('release.moveLock: true, the push delivery', () => {
  it('lands one commit holding the new version in package.json, the changelog section and rafa.lock at that version', async () => {
    const w = world({ name: RAFA_NAME, lock: lockAt('0.4.0'), config: KEY_ON });
    const first = w.git(w.origin, ['rev-parse', 'main~2']);

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Lock: rafa.lock moved to 0.5.0.');
    expect(w.git(w.origin, ['rev-list', '--count', `${first}..main`])).toBe('3');
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'main'])).toBe('chore: release 0.5.0');
    expect(w.git(w.origin, ['show', 'main:rafa.lock'])).toBe(lockAt('0.5.0').trim());
    expect(JSON.parse(w.git(w.origin, ['show', 'main:package.json'])).version).toBe('0.5.0');
    expect(w.git(w.origin, ['show', 'main:CHANGELOG.md'])).toContain('## 0.5.0 — ');
    expect(changedIn(w, 'main')).toEqual(expect.arrayContaining(['CHANGELOG.md', 'package.json', 'rafa.lock']));
  });

  it('creates rafa.lock at the new version when the base holds none', async () => {
    const w = world({ name: RAFA_NAME, lock: null, config: KEY_ON });

    const run = await settle(w);

    expect(run.exitCode).toBe(0);
    expect(w.git(w.origin, ['show', 'main:rafa.lock'])).toBe(lockAt('0.5.0').trim());
    expect(changedIn(w, 'main')).toContain('rafa.lock');
  });
});

describe('release.moveLock: true, the pr delivery', () => {
  it('puts the same commit on rafa/release, leaving main alone', async () => {
    const w = world({ name: RAFA_NAME, lock: lockAt('0.4.0'), config: `${KEY_ON}  settle: pr\n` });
    const before = w.git(w.origin, ['rev-parse', 'main']);
    const double = opening();

    const run = await settle(w, { pullRequests: () => double.pulls, readRemote: () => GITHUB_REMOTE });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Lock: rafa.lock moved to 0.5.0.');
    expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
    expect(w.git(w.origin, ['log', '-1', '--format=%s', 'rafa/release'])).toBe('chore: release 0.5.0');
    expect(w.git(w.origin, ['rev-list', '--count', 'main..rafa/release'])).toBe('1');
    expect(w.git(w.origin, ['show', 'rafa/release:rafa.lock'])).toBe(lockAt('0.5.0').trim());
    expect(JSON.parse(w.git(w.origin, ['show', 'rafa/release:package.json'])).version).toBe('0.5.0');
    expect(w.git(w.origin, ['show', 'rafa/release:CHANGELOG.md'])).toContain('## 0.5.0 — ');
    expect(changedIn(w, 'rafa/release')).toEqual(expect.arrayContaining(['CHANGELOG.md', 'package.json', 'rafa.lock']));
  });
});
