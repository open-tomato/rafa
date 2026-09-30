/**
 * Tests for the "claim lost" reading (`lost.ts`), over a real bare
 * repository and two clones of it, `a` and `b`, standing for two
 * devices. Every case plants its own trio under this suite's temporary
 * directory, so no case sees another's refs.
 *
 * The usual story: `a` claims #7 and commits work on its local branch,
 * `b` takes the claim over on the remote, and `a`'s push is refused.
 * Each case asserts that the refusal it reads is real (a push by `a`
 * that git refuses) and reads the remote from the bare repository
 * itself, so "the new owner's tip is unchanged" is a reading of the
 * remote, not of the clone that failed.
 */
import type { RefusedPushReading } from './lost.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';

import { fetchClaimBranches, makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from './git.js';
import { claimLostReport, lostBranchFor, readRefusedPush } from './lost.js';

/** The claim branch every case pushes. */
const BRANCH = 'feat/rafa-7-claim-lost';

/** The branch its commits are kept on. */
const LOST = 'lost/rafa-7-claim-lost';

/** The store ids the two devices claim under. */
const STORE_A = 'store-a';
const STORE_B = 'store-b';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claims-lost-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A bare remote and two clones of it, each with a runner. */
interface Trio {
  readonly origin: GitRunner;
  readonly a: GitRunner;
  readonly b: GitRunner;
}

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Makes `dir` a clone of `originPath` with an identity of its own. */
function cloneInto(originPath: string, dir: string, name: string): GitRunner {
  must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
  const git = createGitRunner(dir);
  must(git, ['config', 'user.name', name]);
  must(git, ['config', 'user.email', `${name}@example.invalid`]);
  must(git, ['config', 'commit.gpgsign', 'false']);
  return git;
}

/** Plants a bare remote whose `main` holds one commit, and clones it twice. */
function plantTrio(name: string): Trio {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seedPath = join(root, 'seed');
  const seed = cloneInto(originPath, seedPath, 'seed');
  writeFileSync(join(seedPath, 'kept.txt'), 'kept\n', 'utf8');
  must(seed, ['add', '--all']);
  must(seed, ['commit', '--quiet', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return {
    origin: createGitRunner(originPath),
    a: cloneInto(originPath, join(root, 'a'), 'device-a'),
    b: cloneInto(originPath, join(root, 'b'), 'device-b'),
  };
}

/** What `ref` points at in `git`, or null when it does not exist. */
function tipOf(git: GitRunner, ref: string): string | null {
  const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** An empty work commit on `parent`, with no ref moved. */
function workOn(git: GitRunner, parent: string, message: string): string {
  return must(git, ['commit-tree', `${parent}^{tree}`, '-p', parent, '-m', message]);
}

/** `a` claims #7 on the remote and commits one work commit on its local branch; answers the claim and the work. */
function claimAndWork(trio: Trio): { readonly claim: string; readonly work: string } {
  const made = makeOwnershipCommit(trio.a, 'main', { action: 'claim', issue: 7, store: STORE_A });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(trio.a, made.sha, BRANCH);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  const work = workOn(trio.a, made.sha, 'feat: work of device a');
  must(trio.a, ['update-ref', `refs/heads/${BRANCH}`, work]);
  return { claim: made.sha, work };
}

/** `b` pushes a take commit by `store` on the remote tip, with that tip as lease; answers the new tip. */
function takeOver(trio: Trio, store: string = STORE_B): string {
  if (!fetchClaimBranches(trio.b).ok) throw new Error('b could not fetch');
  const lease = must(trio.b, ['rev-parse', `refs/remotes/origin/${BRANCH}`]);
  const made = makeOwnershipCommit(trio.b, lease, { action: 'take', issue: 7, store });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushOwnershipCommit(trio.b, made.sha, BRANCH, lease);
  if (pushed.outcome !== 'pushed') throw new Error(`take push: ${pushed.outcome}`);
  return made.sha;
}

/** `b` offers the claim it holds to `to` with a handover commit; answers the new tip. */
function handTo(trio: Trio, to: string): string {
  if (!fetchClaimBranches(trio.b).ok) throw new Error('b could not fetch');
  const lease = must(trio.b, ['rev-parse', `refs/remotes/origin/${BRANCH}`]);
  const made = makeOwnershipCommit(trio.b, lease, { action: 'hand', issue: 7, store: STORE_B, to });
  if (!made.ok) throw new Error(made.reason);
  if (pushOwnershipCommit(trio.b, made.sha, BRANCH, lease).outcome !== 'pushed') throw new Error('hand push');
  return made.sha;
}

/** `a` pushes its local branch as the wrap-up does, asserting the remote refused it. */
function pushRefused(trio: Trio): void {
  const pushed = trio.a(['push', 'origin', BRANCH]);
  expect(pushed.ok).toBe(false);
  expect(pushed.stderr).toContain('[rejected]');
}

/** The remote's tip of the claim branch, as `b` fetches it. */
function remoteTipAsB(trio: Trio): string {
  if (!fetchClaimBranches(trio.b).ok) throw new Error('b could not fetch');
  return must(trio.b, ['rev-parse', `refs/remotes/origin/${BRANCH}`]);
}

/** A runner that passes through to `git` and records every argv it was handed. */
function recording(git: GitRunner, calls: string[][]): GitRunner {
  return (args) => {
    calls.push([...args]);
    return git(args);
  };
}

/** The reading narrowed to `lost`, or a failed assertion naming what it was. */
function asLost(reading: RefusedPushReading): Extract<RefusedPushReading, { outcome: 'lost' }> {
  if (reading.outcome !== 'lost') throw new Error(`expected lost, read ${JSON.stringify(reading)}`);
  return reading;
}

describe('lostBranchFor', () => {
  it('answers lost/<stub> for a claim branch', () => {
    expect(lostBranchFor(BRANCH)).toBe(LOST);
    expect(lostBranchFor('feat/rafa-12')).toBe('lost/rafa-12');
  });

  it('throws on a branch that is no claim branch', () => {
    expect(() => lostBranchFor('feat/other')).toThrow('is not a feat/rafa-<n> branch');
    expect(() => lostBranchFor('main')).toThrow('is not a feat/rafa-<n> branch');
  });
});

describe('readRefusedPush when another store took the claim', () => {
  it('keeps this device\'s commits on lost/<stub>, names the new owner and pushes nothing', () => {
    const trio = plantTrio('taken');
    const { work } = claimAndWork(trio);
    const newTip = takeOver(trio);
    pushRefused(trio);
    const calls: string[][] = [];

    const lost = asLost(readRefusedPush(recording(trio.a, calls), { branch: BRANCH, storeId: STORE_A }));

    expect(lost).toMatchObject({ issue: 7, branch: BRANCH, owner: STORE_B, pending: null, storeId: STORE_A, remoteTip: newTip });
    expect(lost.kept).toEqual({ state: 'created', name: LOST, sha: work });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBe(work);
    expect(tipOf(trio.a, `refs/heads/${BRANCH}`)).toBe(work);
    expect(tipOf(trio.origin, `refs/heads/${BRANCH}`)).toBe(newTip);
    expect(tipOf(trio.origin, `refs/heads/${LOST}`)).toBeNull();
    expect(calls.some((argv) => argv[0] === 'fetch')).toBe(true);
    expect(calls.some((argv) => argv[0] === 'push')).toBe(false);
    expect(calls.some((argv) => argv.some((arg) => arg.startsWith('--force')))).toBe(false);
  });

  it('answers existing and writes nothing when lost/<stub> already holds the tip', () => {
    const trio = plantTrio('again');
    const { work } = claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);
    readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A });
    const calls: string[][] = [];

    const lost = asLost(readRefusedPush(recording(trio.a, calls), { branch: BRANCH, storeId: STORE_A }));

    expect(lost.kept).toEqual({ state: 'existing', name: LOST, sha: work });
    expect(calls.some((argv) => argv[0] === 'update-ref')).toBe(false);
  });

  it('fast-forwards lost/<stub> from an ancestor of the tip', () => {
    const trio = plantTrio('advance');
    const { claim, work } = claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);
    must(trio.a, ['update-ref', `refs/heads/${LOST}`, claim]);

    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A }));

    expect(lost.kept).toEqual({ state: 'advanced', name: LOST, sha: work });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBe(work);
  });

  it('leaves a lost/<stub> holding other commits where it was, and says the commits stay on the local branch', () => {
    const trio = plantTrio('occupied');
    const { work } = claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);
    const other = workOn(trio.a, must(trio.a, ['rev-parse', 'main']), 'an earlier lost run');
    must(trio.a, ['update-ref', `refs/heads/${LOST}`, other]);

    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A }));

    expect(lost.kept).toMatchObject({ state: 'failed', name: LOST, sha: work });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBe(other);
    expect(claimLostReport(lost)).toContain(`This device's commits stay on the local ${BRANCH} at ${work}: ${LOST} already holds ${other}`);
  });

  it('answers failed with no sha when the local branch is gone', () => {
    const trio = plantTrio('no-local');
    claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);
    must(trio.a, ['update-ref', '-d', `refs/heads/${BRANCH}`]);

    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A }));

    expect(lost.kept).toEqual({ state: 'failed', name: LOST, sha: null, reason: `the local ${BRANCH} could not be read` });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBeNull();
  });

  it('reads a device whose store names no id as not the owner', () => {
    const trio = plantTrio('no-id');
    const { work } = claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);

    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: null }));

    expect(lost.kept).toEqual({ state: 'created', name: LOST, sha: work });
    expect(claimLostReport(lost)).toContain('not by this device, whose store names no claimant.');
  });

  it('carries a handover the new owner offered to this store into the report\'s next step', () => {
    const trio = plantTrio('offered');
    claimAndWork(trio);
    takeOver(trio);
    handTo(trio, STORE_A);
    pushRefused(trio);

    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A }));

    expect(lost.owner).toBe(STORE_B);
    expect(lost.pending?.to).toBe(STORE_A);
    expect(claimLostReport(lost)).toContain('rafa claim accept 7 takes it up.');
  });
});

describe('readRefusedPush when the claim was not lost', () => {
  it('answers owned when this store still holds the remote claim, and makes no lost branch', () => {
    const trio = plantTrio('owned');
    claimAndWork(trio);
    const otherWork = workOn(trio.b, remoteTipAsB(trio), 'work from elsewhere');
    must(trio.b, ['push', '--quiet', 'origin', `${otherWork}:refs/heads/${BRANCH}`]);
    pushRefused(trio);

    const reading = readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'not-lost', cause: 'owned' });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBeNull();
    // Control: the same remote, read by a device of another store, is lost.
    expect(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_B }).outcome).toBe('lost');
  });

  it('answers released when the latest ownership commit is a release', () => {
    const trio = plantTrio('released');
    claimAndWork(trio);
    if (!fetchClaimBranches(trio.b).ok) throw new Error('b could not fetch');
    const lease = must(trio.b, ['rev-parse', `refs/remotes/origin/${BRANCH}`]);
    const made = makeOwnershipCommit(trio.b, lease, { action: 'release', issue: 7, store: STORE_A });
    if (!made.ok) throw new Error(made.reason);
    expect(pushOwnershipCommit(trio.b, made.sha, BRANCH, lease).outcome).toBe('pushed');
    pushRefused(trio);

    const reading = readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'not-lost', cause: 'released' });
    expect(tipOf(trio.a, `refs/heads/${LOST}`)).toBeNull();
  });

  it('answers no-claim for a remote branch with no claim commit', () => {
    const trio = plantTrio('no-claim');
    const main = must(trio.b, ['rev-parse', 'main']);
    must(trio.b, ['push', '--quiet', 'origin', `${workOn(trio.b, main, 'plain work')}:refs/heads/${BRANCH}`]);

    const reading = readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'not-lost', cause: 'no-claim' });
  });

  it('answers absent when the remote has no such branch', () => {
    const trio = plantTrio('absent');

    const reading = readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'not-lost', cause: 'absent', branch: BRANCH });
  });

  it('answers not-a-claim-branch without running git', () => {
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push([...args]);
      return { ok: true, stdout: '', stderr: '' };
    };

    const reading = readRefusedPush(git, { branch: 'feat/no-issue', storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'not-lost', cause: 'not-a-claim-branch' });
    expect(calls).toEqual([]);
  });

  it('answers unknown with what git said when the fetch fails, and reads nothing more', () => {
    const calls: string[][] = [];
    const refusal: GitResult = { ok: false, stdout: '', stderr: 'fatal: unable to access origin' };
    const git: GitRunner = (args) => {
      calls.push([...args]);
      return refusal;
    };

    const reading = readRefusedPush(git, { branch: BRANCH, storeId: STORE_A });

    expect(reading).toMatchObject({ outcome: 'unknown', issue: 7, branch: BRANCH });
    expect(reading.outcome === 'unknown' && reading.reason).toContain('fatal: unable to access origin');
    expect(calls.map((argv) => argv[0])).toEqual(['fetch']);
  });
});

describe('claimLostReport', () => {
  it('names the new owner, the refused push, the kept branch and the next step', () => {
    const trio = plantTrio('report');
    const { work } = claimAndWork(trio);
    takeOver(trio);
    pushRefused(trio);
    const lost = asLost(readRefusedPush(trio.a, { branch: BRANCH, storeId: STORE_A }));

    expect(claimLostReport(lost)).toBe([
      `❌ Claim lost: #7 is claimed by store ${STORE_B} on ${BRANCH}, not by this device (store ${STORE_A}).`,
      `   origin refused the push of ${BRANCH}, and nothing was force-pushed over store ${STORE_B}'s branch.`,
      `   This device's commits are kept on the local branch ${LOST} at ${work}.`,
      `   Next safe step: agree with store ${STORE_B} who carries #7 on; it can hand the claim back with rafa claim hand 7 --to=${STORE_A}.`,
    ].join('\n'));
  });
});
