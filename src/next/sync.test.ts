/**
 * Tests for the `sync` step (`./sync.ts`): what it answers for a base
 * behind its remote, one that is level, one that is only ahead, one
 * that has diverged, and each way the two git commands can fail.
 *
 * The cases that measure a STANDING drive the real git, in repositories
 * of their own under this file's temporary directory: a bare remote,
 * the clone under test and a second clone that pushes to the remote
 * behind its back. That is the point of them — the refusal exists for a
 * standing only git can really produce, and a fast-forward that moved
 * nothing would pass every stubbed case. None of them touches the
 * repository this file lives in, and none reaches a network: every
 * remote is a directory under `tmpdir()`.
 *
 * The cases that measure a FAILURE drive a stubbed runner instead, one
 * answer per command in the order the module spawns them, since a git
 * that cannot read a standing and a git that answered two words which
 * are no counts are both shapes a real git will not produce on demand.
 * Both kinds of runner record the argv they were handed, which is what
 * the cases holding that nothing is fetched and that no merge follows a
 * divergence read.
 *
 * ## What passes while wrong
 *
 * Four mutations of `sync.ts` were driven on 2026-09-21, one at a time,
 * over `env -u CLAUDECODE bun test src/next/sync.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c` each time,
 * against 12 pass and 0 fail either side:
 *
 *  - the divergence refusal dropped, so the merge runs on a base that
 *    has diverged: 8 pass and 4 fail, the three divergence cases and
 *    the case that reads a base and remote of other names.
 *  - the two sides of the `rev-list` range swapped, which reads ahead
 *    as behind: 7 pass and 5 fail, every case that reads the argv and
 *    both refusals quoting what git answered. The fast-forward case
 *    passes, since the merge still moves the base — which is the
 *    silent half this file exists to cover.
 *  - a `git fetch` added ahead of the standing read: 4 pass and 8 fail,
 *    the case that counts the calls and every stubbed case, whose
 *    answers the extra call consumes out of order.
 *  - a merge git refused read as a sync: 11 pass and 1 fail, the merge
 *    failure case alone. Nothing else spawns a merge that fails.
 */
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';

import { fastForwardBase } from './sync.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-sync-')));

/** The plan every case runs, the base being the branch each clone is on. */
const PLAN = Object.freeze({ base: 'main', remote: 'origin' });

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A clone with one commit pushed, and the bare remote it was pushed to. */
interface Planted {
  /** The clone under test, on `main`. */
  readonly root: string;
  /** The bare repository it calls `origin`. */
  readonly bare: string;
  /** A runner made for the clone. */
  readonly git: GitRunner;
}

/** Gives a repository an identity of its own, so a commit can be made in it. */
function identify(git: GitRunner): void {
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
}

/** Writes a file in `root` and commits it, the message doubling as its content. */
function commitFile(root: string, name: string, message: string): void {
  writeFileSync(join(root, name), `${message}\n`, 'utf8');
  const git = createGitRunner(root);
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', message]);
}

/** A bare remote and a clone on `main` holding one commit, both pushed and tracking. */
function plantClone(name: string): Planted {
  const outside = createGitRunner(tempBase);
  const bare = join(tempBase, `${name}-remote.git`);
  outside(['init', '--bare', '--initial-branch=main', bare]);
  const root = join(tempBase, name);
  outside(['init', '--initial-branch=main', root]);
  const git = createGitRunner(root);
  identify(git);
  commitFile(root, 'kept.txt', 'first');
  git(['remote', 'add', 'origin', bare]);
  git(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  return { root, bare, git };
}

/** Puts one more commit on the remote's `main`, through a clone of its own. */
function pushFromElsewhere(planted: Planted, name: string): string {
  const other = join(tempBase, `${name}-elsewhere`);
  createGitRunner(tempBase)(['clone', '--quiet', planted.bare, other]);
  const git = createGitRunner(other);
  identify(git);
  commitFile(other, 'theirs.txt', 'theirs');
  git(['push', '--quiet', 'origin', 'main']);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

/** What a runner was handed, each call one line of argv. */
type Calls = string[];

/** The runner, wrapped so every call is recorded before it is made. */
function recording(git: GitRunner, calls: Calls): GitRunner {
  return (args) => {
    calls.push(args.join(' '));
    return git(args);
  };
}

/** A runner answering the given results in order, recording what it was handed. */
function stubbed(results: readonly GitResult[], calls: Calls): GitRunner {
  let next = 0;
  return (args) => {
    calls.push(args.join(' '));
    const result = results[next] ?? { ok: false, stdout: '', stderr: 'the stub ran out of answers' };
    next += 1;
    return result;
  };
}

/** One git result, its unnamed streams empty. */
function said(ok: boolean, stdout = '', stderr = ''): GitResult {
  return { ok, stdout, stderr };
}

/** Where the clone's `main` is, as a commit id. */
function headOf(planted: Planted): string {
  return planted.git(['rev-parse', 'HEAD']).stdout.trim();
}

/** The refusal a case read, or a throw naming what it got instead. */
function refusalOf(outcome: ReturnType<typeof fastForwardBase>): string {
  if (outcome.kind !== 'refused') {
    throw new Error(`expected a refusal, got ${JSON.stringify(outcome)}`);
  }
  return outcome.message;
}

/** What a case that synced read, or a throw naming the refusal it got instead. */
function syncedSaid(outcome: ReturnType<typeof fastForwardBase>): string {
  if (outcome.kind !== 'synced') {
    throw new Error(`expected a sync, got ${JSON.stringify(outcome)}`);
  }
  return outcome.said;
}

describe('a base behind its remote', () => {
  it('fast-forwards it onto the remote commit, and says so in git\'s own words', () => {
    const planted = plantClone('behind');
    const theirs = pushFromElsewhere(planted, 'behind');
    planted.git(['fetch', '--quiet', 'origin', 'main']);

    const outcome = fastForwardBase(planted.git, PLAN);

    expect(syncedSaid(outcome)).toContain('Fast-forward');
    expect(headOf(planted)).toBe(theirs);
  });

  it('spawns no fetch of its own: the standing it reads is the one already fetched', () => {
    const planted = plantClone('no-fetch');
    pushFromElsewhere(planted, 'no-fetch');
    planted.git(['fetch', '--quiet', 'origin', 'main']);
    const calls: Calls = [];

    fastForwardBase(recording(planted.git, calls), PLAN);

    expect(calls.some((call) => call.startsWith('fetch'))).toBe(false);
    expect(calls).toEqual([
      'rev-list --left-right --count main...origin/main',
      'merge --ff-only origin/main',
    ]);
  });
});

describe('a base that is level or ahead alone', () => {
  it('answers a sync that moved nothing when the two agree', () => {
    const planted = plantClone('level');
    const before = headOf(planted);

    const outcome = fastForwardBase(planted.git, PLAN);

    expect(syncedSaid(outcome)).toContain('Already up to date');
    expect(headOf(planted)).toBe(before);
  });

  it('leaves a base carrying unpushed commits where it is, rather than refusing it', () => {
    const planted = plantClone('ahead');
    commitFile(planted.root, 'mine.txt', 'mine');
    const before = headOf(planted);

    const outcome = fastForwardBase(planted.git, PLAN);

    expect(syncedSaid(outcome)).toContain('Already up to date');
    expect(headOf(planted)).toBe(before);
  });
});

describe('a base that has diverged', () => {
  /** A clone one commit ahead of a remote that is itself one commit on. */
  function plantDiverged(name: string): Planted {
    const planted = plantClone(name);
    pushFromElsewhere(planted, name);
    commitFile(planted.root, 'mine.txt', 'mine');
    planted.git(['fetch', '--quiet', 'origin', 'main']);
    return planted;
  }

  it('refuses, naming both counts and what the person does about them', () => {
    const planted = plantDiverged('diverged');

    const message = refusalOf(fastForwardBase(planted.git, PLAN));

    expect(message.split('\n')).toEqual([
      '❌ Refusing to fast-forward main: it has diverged from origin/main.',
      '   main is 1 commit ahead of origin/main and 1 commit behind it.',
      '   Push, rebase or reset main, then run again.',
    ]);
  });

  it('spawns no merge and moves nothing', () => {
    const planted = plantDiverged('diverged-untouched');
    const before = headOf(planted);
    const calls: Calls = [];

    fastForwardBase(recording(planted.git, calls), PLAN);

    expect(calls).toEqual(['rev-list --left-right --count main...origin/main']);
    expect(headOf(planted)).toBe(before);
  });

  it('counts more than one commit on each side as the plural it is', () => {
    const calls: Calls = [];
    const git = stubbed([said(true, '3\t2\n')], calls);

    const message = refusalOf(fastForwardBase(git, PLAN));

    expect(message).toContain('main is 3 commits ahead of origin/main and 2 commits behind it.');
  });
});

describe('a git that would not answer', () => {
  it('refuses a standing it could not read, quoting git and saying nothing moved', () => {
    const calls: Calls = [];
    const git = stubbed([said(false, '', 'fatal: ambiguous argument \'main...origin/main\'')], calls);

    const message = refusalOf(fastForwardBase(git, PLAN));

    expect(message.split('\n')).toEqual([
      '❌ Could not read how main stands against origin/main.',
      '   fatal: ambiguous argument \'main...origin/main\'',
      '   main has not moved.',
    ]);
    expect(calls).toEqual(['rev-list --left-right --count main...origin/main']);
  });

  it('refuses an answer that is no pair of counts, quoting the answer itself', () => {
    const calls: Calls = [];
    const git = stubbed([said(true, 'nothing at all\n')], calls);

    const message = refusalOf(fastForwardBase(git, PLAN));

    expect(message).toContain('git answered "nothing at all\\n", which is no pair of counts.');
    expect(calls).toEqual(['rev-list --left-right --count main...origin/main']);
  });

  it('refuses a merge git would not make, quoting what it said', () => {
    const calls: Calls = [];
    const git = stubbed([
      said(true, '0\t1\n'),
      said(false, '', 'fatal: Not possible to fast-forward, aborting.'),
    ], calls);

    const message = refusalOf(fastForwardBase(git, PLAN));

    expect(message.split('\n')).toEqual([
      '❌ Could not fast-forward main to origin/main.',
      '   fatal: Not possible to fast-forward, aborting.',
      '   main has not moved.',
    ]);
  });

  it('refuses a git it could not run at all, carrying the runner\'s own sentence', () => {
    const calls: Calls = [];
    const git = stubbed([said(false, '', 'could not run git in /gone: ENOENT')], calls);

    const message = refusalOf(fastForwardBase(git, PLAN));

    expect(message).toContain('could not run git in /gone: ENOENT');
  });
});

describe('the base and the remote it is given', () => {
  it('names both in every command and every sentence, rather than assuming origin/main', () => {
    const calls: Calls = [];
    const git = stubbed([said(true, '2\t2\n')], calls);

    const message = refusalOf(fastForwardBase(git, { base: 'trunk', remote: 'upstream' }));

    expect(calls).toEqual(['rev-list --left-right --count trunk...upstream/trunk']);
    expect(message).toContain('❌ Refusing to fast-forward trunk: it has diverged from upstream/trunk.');
  });
});
