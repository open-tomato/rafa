/**
 * Tests for `tagSettle` (`settle-tag.ts`): the `release.tag: settle`
 * step, over real repositories — a bare origin, a clone that lands
 * commits on `main` as merges would, and the caller's clone on a feature
 * branch, which settles in the scratch worktree `withSettleWorktree`
 * makes and pushes through `settleByPush` before the step runs.
 *
 * Each skip is paired with the control that the same world under
 * `release.tag: settle` and a `push` delivery does write the tag, and
 * every skip is also shown to run no git at all.
 */
import type { Fragment } from './fragment.js';
import type { SettleDelivered, SettleTagOutcome } from './settle-tag.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleBuilt, SettleSettings } from './settle.js';
import type { ReleaseTagMode } from '../config-readers.js';
import type { GitResult, GitRunner, PullRequestSummary } from '../pr/index.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { serializeFragment } from './fragment.js';
import { PUSH_SAID_NOTHING, settleByPush } from './settle-push.js';
import { RELEASE_TAG_COMMAND, tagSettle } from './settle-tag.js';
import { withSettleWorktree } from './settle-worktree.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-tag-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case settles under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The manifest on `main`. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main`. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The tag a settle of the planted batch writes: 0.4.0 bumped by a minor. */
const TAG = 'v0.5.0';

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
function fragmentText(plan: string, level: Fragment['level'], notes: readonly string[]): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone. */
interface World {
  readonly origin: string;
  readonly caller: string;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes (text) or deletes (null) each path in the other clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string | null>>, message: string) => string;
}

/** Builds a {@link World} with `rafa-9` (minor) and `rafa-1` (patch) waiting on `main`. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string | null>>, message: string): string => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        git(other, ['rm', '-q', '--', path]);
        continue;
      }
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
    return git(other, ['rev-parse', 'HEAD']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  for (const [key, value] of [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(dir, 'no-hooks')]]) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'package.json'), `${MANIFEST}work in flight\n`);

  const w: World = { origin, caller, scratchRoot, git, land };
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', ['- Walk: one hop']) }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', ['- Loop: a fix']) }, 'merge rafa-1');
  return w;
}

/** What one settle answered, with every argv the tag step ran. */
interface Tagged {
  readonly delivered: SettleDelivered;
  readonly tagged: SettleTagOutcome;
  /** The argv the tag step alone ran, in order. */
  readonly tagArgv: readonly (readonly string[])[];
}

/** Options of {@link settleAndTag}. */
interface SettleAndTagOptions {
  readonly mode?: ReleaseTagMode;
  /** Runs just before the settle's n-th push reaches git. */
  readonly beforePush?: readonly (() => void)[];
  /** Turns the push delivery's answer into what the tag step is given; the push delivery as it answered unless named. */
  readonly deliver?: (pushed: SettleDelivered) => SettleDelivered;
  /** Answered for the tag step's push in place of running it; git's own answer unless named. */
  readonly tagPushAnswer?: GitResult;
  /** Handed what the tag step's push answered. */
  readonly afterTagPush?: (result: GitResult) => void;
}

/** Settles by push in a scratch worktree of the caller's `origin/main`, then runs the tag step there. */
async function settleAndTag(w: World, options: SettleAndTagOptions = {}): Promise<Tagged> {
  const { mode = 'settle', beforePush = [], deliver = (pushed) => pushed, tagPushAnswer, afterTagPush } = options;
  let pushes = 0;
  const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (made: SettleWorktree) => {
    const settleGit: GitRunner = (args) => {
      if (args[0] === 'push') {
        beforePush[pushes]?.();
        pushes += 1;
      }
      return made.git(args);
    };
    const delivered = deliver({ delivery: 'push', outcome: settleByPush({ ...made, git: settleGit }, SETTINGS) });
    const tagArgv: string[][] = [];
    const tagGit: GitRunner = (args) => {
      tagArgv.push([...args]);
      if (args[0] !== 'push') return made.git(args);
      const result = tagPushAnswer ?? made.git(args);
      afterTagPush?.(result);
      return result;
    };
    return { delivered, tagged: tagSettle({ ...made, git: tagGit }, mode, delivered), tagArgv };
  });
  if (!outcome.ok) throw new Error(outcome.problem);
  return outcome.value;
}

/** Origin's `main`, read from the bare repository. */
function originMain(w: World): string {
  return w.git(w.origin, ['rev-parse', 'refs/heads/main']);
}

/** The tags `repo` holds, one per line, or none. */
function tagsIn(w: World, repo: string): string[] {
  const listed = w.git(repo, ['tag', '--list']);
  return listed === ''
    ? []
    : listed.split('\n');
}

/** The lines of `text`, each trimmed. */
function linesOf(text: string): string[] {
  return text.split('\n').map((line) => line.trim());
}

/** The commit `tag` names in `repo`. */
function tagCommit(w: World, repo: string, tag: string): string {
  return w.git(repo, ['rev-parse', `refs/tags/${tag}^{commit}`]);
}

/** The pushed build of a delivery, for a case that needs its commit. */
function pushedBuild(delivered: SettleDelivered): SettleBuilt {
  if (delivered.delivery !== 'push' || delivered.outcome.outcome !== 'pushed') {
    throw new Error(`expected a pushed delivery, got ${delivered.outcome.outcome}`);
  }
  return delivered.outcome.build;
}

/** The pull request a `pr` delivery would name. */
const RELEASE_PULL: PullRequestSummary = {
  number: 7,
  title: 'chore: release 0.5.0',
  url: 'https://example.invalid/pull/7',
  state: 'open',
  headRefName: 'rafa/release',
  baseRefName: 'main',
  author: { login: 'rafa', isBot: false },
  isCrossRepository: false,
  updatedAt: SETUP_DATE,
};

describe('tagSettle under release.tag: settle and a push delivery', () => {
  it('tags the commit the push put on main and pushes the tag, leaving the caller\'s checkout as it was', async () => {
    const w = world();
    const callerStatus = w.git(w.caller, ['status', '--porcelain']);

    const run = await settleAndTag(w);

    const build = pushedBuild(run.delivered);
    expect(run.tagged).toEqual({
      outcome: 'tagged',
      exitCode: 0,
      tag: TAG,
      commit: build.release,
      sentence: `${TAG} names ${build.release.slice(0, 12)} and is pushed to origin`,
    });
    expect(originMain(w)).toBe(build.release);
    expect(tagCommit(w, w.origin, TAG)).toBe(build.release);
    // Tags are shared with the worktree's repository: the caller holds it too.
    expect(tagCommit(w, w.caller, TAG)).toBe(build.release);
    expect(w.git(w.caller, ['branch', '--show-current'])).toBe('feat');
    expect(w.git(w.caller, ['status', '--porcelain'])).toBe(callerStatus);
    expect(callerStatus).toBe('M package.json');
  });

  it('never forces the tag push', async () => {
    const w = world();

    const run = await settleAndTag(w);

    const pushes = run.tagArgv.filter((args) => args[0] === 'push');
    expect(pushes).toEqual([['push', '--porcelain', 'origin', `refs/tags/${TAG}:refs/tags/${TAG}`]]);
  });

  it('tags the rebuilt commit when the push was retried, not the first build', async () => {
    const w = world();
    const late = (): void => {
      w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', ['- Loop: late']) }, 'merge rafa-4');
    };

    const run = await settleAndTag(w, { beforePush: [late] });

    expect(run.delivered.outcome.attempts).toBe(2);
    const build = pushedBuild(run.delivered);
    expect(build.deleted).toContain('.changes/rafa-4.md');
    expect(run.tagged.outcome).toBe('tagged');
    expect(tagCommit(w, w.origin, TAG)).toBe(originMain(w));
    expect(originMain(w)).toBe(build.release);
  });

  it('keeps a local tag that already names the release commit and pushes it', async () => {
    const w = world();
    const first = await settleAndTag(w);
    const build = pushedBuild(first.delivered);
    w.git(w.origin, ['tag', '-d', TAG]);

    const tagged = tagSettle(
      { path: w.caller, git: createGitRunner(w.caller), remote: 'origin', branch: 'main', ref: 'origin/main', commit: build.release },
      'settle',
      first.delivered,
    );

    expect(tagged.outcome).toBe('tagged');
    expect(tagCommit(w, w.origin, TAG)).toBe(build.release);
  });
});

describe('tagSettle, the readings that write no tag', () => {
  it('writes nothing and runs no git under release.tag: manual', async () => {
    const w = world();

    const run = await settleAndTag(w, { mode: 'manual' });

    expect(run.delivered.outcome.outcome).toBe('pushed');
    expect(run.tagged).toEqual({ outcome: 'skipped', exitCode: 0, reason: 'manual', sentence: null });
    expect(run.tagArgv).toEqual([]);
    expect(tagsIn(w, w.origin)).toEqual([]);
    expect(tagsIn(w, w.caller)).toEqual([]);
  });

  it('leaves a delivered pr delivery to rafa release tag, running no git', async () => {
    const w = world();
    const asPr = (pushed: SettleDelivered): SettleDelivered => ({
      delivery: 'pr',
      outcome: { outcome: 'delivered', exitCode: 0, build: pushedBuild(pushed), head: pushedBuild(pushed).release, pushed: true, pull: RELEASE_PULL, action: 'opened' },
    });

    const run = await settleAndTag(w, { deliver: asPr });

    expect(run.tagged).toEqual({
      outcome: 'skipped',
      exitCode: 0,
      reason: 'pr-delivery',
      sentence: `the release pull request is not tagged by settle; run ${RELEASE_TAG_COMMAND} on main once it merges`,
    });
    expect(run.tagArgv).toEqual([]);
    expect(tagsIn(w, w.origin)).toEqual([]);
    expect(tagsIn(w, w.caller)).toEqual([]);
  });

  it('says nothing for a pr delivery that delivered no pull request', async () => {
    const w = world();
    const asFailedPr = (pushed: SettleDelivered): SettleDelivered => ({
      delivery: 'pr',
      outcome: { outcome: 'refused', exitCode: 1, build: pushedBuild(pushed), pushed: false, sentence: 'the lease was refused' },
    });

    const run = await settleAndTag(w, { deliver: asFailedPr });

    expect(run.tagged).toEqual({ outcome: 'skipped', exitCode: 0, reason: 'pr-delivery', sentence: null });
    expect(run.tagArgv).toEqual([]);
  });

  it('tags nothing for a settle another settle superseded', async () => {
    const w = world();
    const race = (): void => {
      w.land({ '.changes/rafa-9.md': null, '.changes/rafa-1.md': null }, 'chore: release 0.5.0');
    };

    const run = await settleAndTag(w, { beforePush: [race] });

    expect(run.delivered.outcome.outcome).toBe('superseded');
    expect(run.tagged).toEqual({ outcome: 'skipped', exitCode: 0, reason: 'not-pushed', sentence: null });
    expect(run.tagArgv).toEqual([]);
    expect(tagsIn(w, w.origin)).toEqual([]);
  });

  it('tags nothing when only none fragments waited', async () => {
    const w = world();
    w.land({ '.changes/rafa-9.md': null, '.changes/rafa-1.md': null, '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'only none');

    const run = await settleAndTag(w);

    expect(run.delivered.outcome.outcome).toBe('unsettled');
    expect(run.tagged).toEqual({ outcome: 'skipped', exitCode: 0, reason: 'not-pushed', sentence: null });
    expect(run.tagArgv).toEqual([]);
  });
});

describe('tagSettle, a tag that cannot land', () => {
  it('exits 1 and writes nothing when a local tag of that name names another commit', async () => {
    const w = world();
    const elsewhere = w.git(w.caller, ['rev-parse', 'origin/main']);
    w.git(w.caller, ['tag', TAG, elsewhere]);

    const run = await settleAndTag(w);

    const build = pushedBuild(run.delivered);
    expect(run.tagged).toEqual({
      outcome: 'failed',
      exitCode: 1,
      tag: TAG,
      commit: build.release,
      written: false,
      sentence: `${TAG} already names ${elsewhere.slice(0, 12)}, not the release commit ${build.release.slice(0, 12)}; settle wrote no tag, so move or delete it by hand and run ${RELEASE_TAG_COMMAND}`,
    });
    expect(run.tagArgv.some((args) => args[0] === 'push' || args[0] === 'tag')).toBe(false);
    expect(tagCommit(w, w.caller, TAG)).toBe(elsewhere);
    expect(tagsIn(w, w.origin)).toEqual([]);
  });

  it('exits 1 with the local tag written when the remote already holds that tag on another commit', async () => {
    const w = world();
    const elsewhere = originMain(w);
    w.git(w.origin, ['tag', TAG, elsewhere]);

    const run = await settleAndTag(w);

    const build = pushedBuild(run.delivered);
    expect(run.tagged.outcome).toBe('failed');
    if (run.tagged.outcome !== 'failed') return;
    expect(run.tagged.exitCode).toBe(1);
    expect(run.tagged.written).toBe(true);
    expect(run.tagged.sentence).toStartWith(`${TAG} is written on ${build.release.slice(0, 12)} but could not be pushed to origin: `);
    expect(run.tagged.sentence).toContain('[rejected] (already exists)');
    expect(tagCommit(w, w.caller, TAG)).toBe(build.release);
    expect(tagCommit(w, w.origin, TAG)).toBe(elsewhere);
  });

  it('quotes the already-exists rejection without the Done line git ends the refused push on', async () => {
    const w = world();
    w.git(w.origin, ['tag', TAG, originMain(w)]);
    const answered: GitResult[] = [];

    const run = await settleAndTag(w, { afterTagPush: (result) => answered.push(result) });

    // The control: git itself ended the refused push on Done, so the check below could fail.
    expect(answered).toHaveLength(1);
    expect(answered[0]?.ok).toBe(false);
    expect(linesOf(answered[0]?.stdout ?? '')).toContain('Done');
    expect(run.tagged.outcome).toBe('failed');
    if (run.tagged.outcome !== 'failed') return;
    expect(run.tagged.sentence).toContain('[rejected] (already exists)');
    expect(linesOf(run.tagged.sentence)).not.toContain('Done');
    expect(run.tagged.sentence).not.toMatch(/Done\s*$/);
  });

  it('still names a failure when the tag push printed nothing but Done', async () => {
    const w = world();

    const run = await settleAndTag(w, { tagPushAnswer: { ok: false, stdout: 'Done\n', stderr: '' } });

    const build = pushedBuild(run.delivered);
    expect(run.tagged).toMatchObject({ outcome: 'failed', exitCode: 1, written: true });
    if (run.tagged.outcome !== 'failed') return;
    expect(run.tagged.sentence).toBe(`${TAG} is written on ${build.release.slice(0, 12)} but could not be pushed to origin: ${PUSH_SAID_NOTHING}`);
    expect(linesOf(run.tagged.sentence)).not.toContain('Done');
    expect(tagsIn(w, w.origin)).toEqual([]);
  });
});
