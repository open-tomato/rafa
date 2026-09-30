/**
 * Tests for the claim git operations (`git.ts`), over a real bare
 * repository and two clones of it, `a` and `b`, standing for two
 * devices. Every case plants its own trio under this suite's temporary
 * directory, so no case sees another's refs.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed, so "the push landed" and "the push
 * changed nothing" are readings of the remote. Each refusal case keeps
 * a control that the same reading moves when a push does land.
 */
import type { ClaimBranchReading, ClaimPush } from './git.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';

import {
  CLAIM_REFSPEC,
  claimBranchIssue,
  fetchClaimBranches,
  makeOwnershipCommit,
  pushNewClaimBranch,
  pushOwnershipCommit,
  readClaimBranch,
} from './git.js';
import { formatClaimMessage, parseClaimMessage } from './record.js';

/** The claim branch most cases race for. */
const BRANCH = 'feat/rafa-7-claim-race';

/** The store ids the two devices claim under. */
const STORE_A = 'store-a';
const STORE_B = 'store-b';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claims-git-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A bare remote and two clones of it, each with a runner. */
interface Trio {
  readonly origin: GitRunner;
  readonly originPath: string;
  readonly a: GitRunner;
  readonly aPath: string;
  readonly b: GitRunner;
  readonly bPath: string;
}

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Makes `dir` a clone of `origin` with an identity of its own. */
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
  const aPath = join(root, 'a');
  const bPath = join(root, 'b');
  return {
    origin: createGitRunner(originPath),
    originPath,
    a: cloneInto(originPath, aPath, 'device-a'),
    aPath,
    b: cloneInto(originPath, bPath, 'device-b'),
    bPath,
  };
}

/** What the remote's `branch` points at, or null when it has none. */
function remoteTip(trio: Trio, branch: string = BRANCH): string | null {
  const result = trio.origin(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** A claim commit by `store` on the clone's `main`, or a throw. */
function claimOn(git: GitRunner, store: string, issue = 7): string {
  const made = makeOwnershipCommit(git, 'main', { action: 'claim', issue, store });
  if (!made.ok) throw new Error(made.reason);
  return made.sha;
}

/** Commits an empty work commit on `parent` with a fixed committer date, answering its sha. */
function workCommitAt(dir: string, parent: string, message: string, date: string): string {
  const result = spawnSync('git', ['commit-tree', `${parent}^{tree}`, '-p', parent, '-m', message], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', GIT_COMMITTER_DATE: date },
  });
  if (result.status !== 0) throw new Error(`commit-tree: ${result.stderr}`);
  return result.stdout.trim();
}

/** A runner that passes through to `git` and records every argv it was handed. */
function recording(git: GitRunner, calls: string[][]): GitRunner {
  return (args) => {
    calls.push([...args]);
    return git(args);
  };
}

/** A runner answering `answer` to every call, recording each. */
function answering(answer: GitResult, calls: string[][]): GitRunner {
  return (args) => {
    calls.push([...args]);
    return answer;
  };
}

/** The reason on an answer that carries one, or a throw naming what it carried instead. */
function reasonOf(answer: object): string {
  if ('reason' in answer && typeof answer.reason === 'string') return answer.reason;
  throw new Error(`expected a reason, read ${JSON.stringify(answer)}`);
}

/** The holder a `claimed` answer names, or a throw naming the outcome instead. */
function holderOf(answer: ClaimPush): ClaimBranchReading {
  if (answer.outcome !== 'claimed') throw new Error(`expected claimed, read ${answer.outcome}`);
  return answer.holder;
}

/** A `found` reading, or a throw naming its state instead. */
function foundOf(reading: ClaimBranchReading): Extract<ClaimBranchReading, { readonly state: 'found' }> {
  if (reading.state !== 'found') throw new Error(`expected found, read ${reading.state}`);
  return reading;
}

describe('claimBranchIssue', () => {
  it('reads the issue off feat/rafa-<n>-<slug> and feat/rafa-<n>', () => {
    expect(claimBranchIssue('feat/rafa-324-claim-issue')).toBe(324);
    expect(claimBranchIssue('feat/rafa-9')).toBe(9);
  });

  it('answers null for any other branch', () => {
    for (const branch of ['main', 'feat/other', 'feat/rafa-', 'feat/rafa-0-x', 'feat/rafa-x-1', 'lost/rafa-7-x', 'feat/rafa-7-']) {
      expect(claimBranchIssue(branch)).toBeNull();
    }
  });
});

describe('makeOwnershipCommit', () => {
  it('makes one empty commit on the parent whose message reads back as the record', () => {
    const trio = plantTrio('make');
    const main = must(trio.a, ['rev-parse', 'main']);
    const record = { action: 'hand', issue: 7, store: STORE_A, to: STORE_B } as const;

    const made = makeOwnershipCommit(trio.a, 'main', record);

    if (!made.ok) throw new Error(made.reason);
    expect(must(trio.a, ['rev-parse', `${made.sha}^`])).toBe(main);
    expect(must(trio.a, ['rev-parse', `${made.sha}^{tree}`])).toBe(must(trio.a, ['rev-parse', 'main^{tree}']));
    const message = must(trio.a, ['log', '-1', '--format=%B', made.sha]);
    expect(message).toBe(formatClaimMessage(record).trim());
    expect(parseClaimMessage(message)).toEqual({ kind: 'ownership', record });
  });

  it('moves no ref and leaves the index and the working tree as they were', () => {
    const trio = plantTrio('untouched');
    writeFileSync(join(trio.aPath, 'kept.txt'), 'edited\n', 'utf8');
    writeFileSync(join(trio.aPath, 'staged.txt'), 'staged\n', 'utf8');
    must(trio.a, ['add', 'staged.txt']);
    writeFileSync(join(trio.aPath, 'loose.txt'), 'loose\n', 'utf8');
    const before = {
      refs: must(trio.a, ['for-each-ref', '--format=%(refname) %(objectname)']),
      head: must(trio.a, ['symbolic-ref', 'HEAD']),
      status: trio.a(['status', '--porcelain']).stdout,
      staged: must(trio.a, ['diff', '--cached', '--name-only']),
    };

    const made = makeOwnershipCommit(trio.a, 'HEAD', { action: 'claim', issue: 7, store: STORE_A });

    expect(made.ok).toBe(true);
    expect(before.status).toBe(' M kept.txt\nA  staged.txt\n?? loose.txt\n');
    expect(must(trio.a, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(before.refs);
    expect(must(trio.a, ['symbolic-ref', 'HEAD'])).toBe(before.head);
    expect(trio.a(['status', '--porcelain']).stdout).toBe(before.status);
    expect(must(trio.a, ['diff', '--cached', '--name-only'])).toBe(before.staged);
  });

  it('answers a parent that names no commit with a reason, and makes nothing', () => {
    const trio = plantTrio('no-parent');
    const calls: string[][] = [];

    const missing = makeOwnershipCommit(recording(trio.a, calls), 'no-such-branch', { action: 'claim', issue: 7, store: STORE_A });
    const option = makeOwnershipCommit(recording(trio.a, calls), '--all', { action: 'claim', issue: 7, store: STORE_A });

    expect(missing).toEqual({ ok: false, reason: 'no-such-branch names no commit' });
    expect(option).toEqual({ ok: false, reason: '"--all" names no commit' });
    expect(calls.map((call) => call[0])).toEqual(['rev-parse']);
  });

  it('throws on a record no reader could read back, before running git', () => {
    const calls: string[][] = [];
    const git = answering({ ok: true, stdout: '', stderr: '' }, calls);

    expect(() => makeOwnershipCommit(git, 'main', { action: 'claim', issue: 7, store: 'two words' })).toThrow('claim record');
    expect(calls).toEqual([]);
  });
});

describe('fetchClaimBranches and readClaimBranch', () => {
  it('reads a branch the remote does not have as absent, the fetch matching nothing', () => {
    const trio = plantTrio('absent');

    expect(fetchClaimBranches(trio.a)).toEqual({ ok: true });
    expect(readClaimBranch(trio.a, BRANCH)).toEqual({ state: 'absent', branch: BRANCH });
  });

  it('reads the tip, its committer date and the ownership commits oldest first, passing work over', () => {
    const trio = plantTrio('found');
    const claim = claimOn(trio.b, STORE_B);
    const work = workCommitAt(trio.bPath, claim, 'feat: work\n\nBody.', '2026-09-01T10:00:00Z');
    const handed = makeOwnershipCommit(trio.b, work, { action: 'hand', issue: 7, store: STORE_B, to: STORE_A });
    if (!handed.ok) throw new Error(handed.reason);
    const tip = workCommitAt(trio.bPath, handed.sha, 'fix: more work', '2026-09-02T12:30:00Z');
    must(trio.b, ['push', '--quiet', 'origin', `${tip}:refs/heads/${BRANCH}`]);

    expect(fetchClaimBranches(trio.a)).toEqual({ ok: true });
    const reading = readClaimBranch(trio.a, BRANCH);

    if (reading.state !== 'found') throw new Error(`expected found, read ${reading.state}`);
    expect(reading.tip).toBe(tip);
    expect(reading.tipCommittedAt.toISOString()).toBe('2026-09-02T12:30:00.000Z');
    expect(reading.commits.map((commit) => commit.sha)).toEqual([claim, handed.sha]);
    expect(reading.ownership).toEqual({ state: 'held', owner: STORE_B, pending: { to: STORE_A, sha: handed.sha }, ignored: [] });
  });

  it('passes over another issue\'s claim commits in the base, and keeps a malformed one to report', () => {
    const trio = plantTrio('history');
    const earlier = claimOn(trio.b, STORE_A, 6);
    const malformed = workCommitAt(trio.bPath, earlier, 'chore: note\n\nRafa-Claim: claim', '2026-09-03T00:00:00Z');
    must(trio.b, ['push', '--quiet', 'origin', `${malformed}:refs/heads/main`]);
    must(trio.b, ['fetch', '--quiet', 'origin']);
    must(trio.b, ['update-ref', 'refs/heads/main', malformed]);
    const claim = claimOn(trio.b, STORE_B);
    must(trio.b, ['push', '--quiet', 'origin', `${claim}:refs/heads/${BRANCH}`]);

    fetchClaimBranches(trio.a);
    const reading = readClaimBranch(trio.a, BRANCH);

    if (reading.state !== 'found') throw new Error(`expected found, read ${reading.state}`);
    expect(reading.commits.map((commit) => commit.sha)).toEqual([malformed, claim]);
    expect(reading.ownership).toEqual({
      state: 'held',
      owner: STORE_B,
      pending: null,
      ignored: [{ sha: malformed, reason: 'no Rafa-Claim-Store trailer' }],
    });
  });

  it('fetches once for any number of reads, and reads spawn no network call', () => {
    const trio = plantTrio('one-fetch');
    must(trio.b, ['push', '--quiet', 'origin', `${claimOn(trio.b, STORE_B)}:refs/heads/${BRANCH}`]);
    must(trio.b, ['push', '--quiet', 'origin', `${claimOn(trio.b, STORE_B, 8)}:refs/heads/feat/rafa-8-other`]);
    const calls: string[][] = [];
    const git = recording(trio.a, calls);

    fetchClaimBranches(git);
    const first = readClaimBranch(git, BRANCH);
    const second = readClaimBranch(git, 'feat/rafa-8-other');
    const third = readClaimBranch(git, 'feat/rafa-9-none');

    expect([first.state, second.state, third.state]).toEqual(['found', 'found', 'absent']);
    const network = calls.filter((call) => ['fetch', 'push', 'pull', 'ls-remote'].includes(call[0] ?? ''));
    expect(network).toEqual([['fetch', '--quiet', '--prune', '--no-tags', 'origin', CLAIM_REFSPEC]]);
  });

  it('reads what the last fetch left: a later push is unseen until the next fetch', () => {
    const trio = plantTrio('stale-read');
    fetchClaimBranches(trio.a);
    must(trio.b, ['push', '--quiet', 'origin', `${claimOn(trio.b, STORE_B)}:refs/heads/${BRANCH}`]);

    const before = readClaimBranch(trio.a, BRANCH).state;
    fetchClaimBranches(trio.a);
    const after = readClaimBranch(trio.a, BRANCH).state;

    expect([before, after]).toEqual(['absent', 'found']);
  });

  it('prunes a claim branch the remote deleted, and fetches no branch outside feat/rafa-*', () => {
    const trio = plantTrio('prune');
    must(trio.b, ['push', '--quiet', 'origin', `${claimOn(trio.b, STORE_B)}:refs/heads/${BRANCH}`]);
    must(trio.b, ['push', '--quiet', 'origin', 'main:refs/heads/feat/other']);
    fetchClaimBranches(trio.a);
    expect(readClaimBranch(trio.a, BRANCH).state).toBe('found');
    must(trio.origin, ['update-ref', '-d', `refs/heads/${BRANCH}`]);

    expect(fetchClaimBranches(trio.a)).toEqual({ ok: true });

    expect(readClaimBranch(trio.a, BRANCH).state).toBe('absent');
    expect(trio.a(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feat/other']).ok).toBe(false);
    expect(trio.a(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']).ok).toBe(true);
  });

  it('answers a remote it cannot reach with what git said', () => {
    const trio = plantTrio('unreachable');
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const fetched = fetchClaimBranches(trio.a);

    expect(fetched.ok).toBe(false);
    expect(reasonOf(fetched)).toContain('does not appear to be a git repository');
  });

  it('answers a directory that is no repository as unreadable, not absent', () => {
    const reading = readClaimBranch(createGitRunner(scope), BRANCH);

    expect(reading.state).toBe('unreadable');
    expect(reasonOf(reading)).toContain('not a git repository');
  });

  it('throws on a branch that is not a claim branch', () => {
    const calls: string[][] = [];

    expect(() => readClaimBranch(answering({ ok: true, stdout: '', stderr: '' }, calls), 'feat/other')).toThrow('is not a feat/rafa-* branch');
    expect(calls).toEqual([]);
  });
});

describe('pushNewClaimBranch', () => {
  it('pushes a claim commit to a branch the remote does not have', () => {
    const trio = plantTrio('new');
    const sha = claimOn(trio.a, STORE_A);

    expect(pushNewClaimBranch(trio.a, sha, BRANCH)).toEqual({ outcome: 'pushed' });
    expect(remoteTip(trio)).toBe(sha);
  });

  it('reads the same sha pushed again as pushed: a retried push that already landed', () => {
    const trio = plantTrio('again');
    const sha = claimOn(trio.a, STORE_A);
    pushNewClaimBranch(trio.a, sha, BRANCH);

    expect(pushNewClaimBranch(trio.a, sha, BRANCH)).toEqual({ outcome: 'pushed' });
    expect(remoteTip(trio)).toBe(sha);
  });

  it('answers claimed naming the holder when the other clone pushed first and this one had not fetched', () => {
    const trio = plantTrio('fetch-first');
    const winner = claimOn(trio.a, STORE_A);
    const loser = claimOn(trio.b, STORE_B);
    expect(pushNewClaimBranch(trio.a, winner, BRANCH)).toEqual({ outcome: 'pushed' });

    const answer = pushNewClaimBranch(trio.b, loser, BRANCH);

    expect(answer.outcome).toBe('claimed');
    const holder = holderOf(answer);
    expect(foundOf(holder).ownership).toEqual({ state: 'held', owner: STORE_A, pending: null, ignored: [] });
    expect(foundOf(holder).tip).toBe(winner);
    expect(remoteTip(trio)).toBe(winner);
  });

  it('answers claimed on the non-fast-forward refusal a clone that had fetched meets', () => {
    const trio = plantTrio('non-ff');
    const winner = claimOn(trio.a, STORE_A);
    pushNewClaimBranch(trio.a, winner, BRANCH);
    fetchClaimBranches(trio.b);
    const loser = claimOn(trio.b, STORE_B);
    const pushed = trio.b(['push', '--porcelain', 'origin', `${loser}:refs/heads/${BRANCH}`]);
    expect(pushed.stdout).toContain('[rejected] (non-fast-forward)');

    const answer = pushNewClaimBranch(trio.b, loser, BRANCH);

    expect(answer.outcome).toBe('claimed');
    expect(remoteTip(trio)).toBe(winner);
  });

  it('answers failed with what git said when the remote cannot be reached', () => {
    const trio = plantTrio('push-unreachable');
    const sha = claimOn(trio.a, STORE_A);
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const answer = pushNewClaimBranch(trio.a, sha, BRANCH);

    expect(answer.outcome).toBe('failed');
    expect(reasonOf(answer)).toContain('does not appear to be a git repository');
  });

  it('answers a refusal of another kind as failed, and fetches nothing after it', () => {
    const calls: string[][] = [];
    const sha = 'a'.repeat(40);
    const git = answering({
      ok: false,
      stdout: `To origin\n!\t${sha}:refs/heads/${BRANCH}\t[remote rejected] (pre-receive hook declined)\nDone\n`,
      stderr: 'error: failed to push some refs',
    }, calls);

    const answer = pushNewClaimBranch(git, sha, BRANCH);

    expect(answer.outcome).toBe('failed');
    expect(reasonOf(answer)).toContain('pre-receive hook declined');
    expect(calls.map((call) => call[0])).toEqual(['push']);
  });

  it('answers claimed with an unreadable holder when the fetch after the refusal fails', () => {
    const sha = 'b'.repeat(40);
    const git: GitRunner = (args) => args[0] === 'push'
      ? { ok: false, stdout: `!\t${sha}:refs/heads/${BRANCH}\t[rejected] (fetch first)\n`, stderr: '' }
      : { ok: false, stdout: '', stderr: 'fatal: the network went away' };

    const answer = pushNewClaimBranch(git, sha, BRANCH);

    expect(answer.outcome).toBe('claimed');
    const holder = holderOf(answer);
    expect(holder.state).toBe('unreadable');
    expect(reasonOf(holder)).toContain('the network went away');
  });
});

describe('pushOwnershipCommit', () => {
  /** A trio whose remote BRANCH holds `a`'s claim, fetched by both clones. */
  function claimedTrio(name: string): { readonly trio: Trio; readonly claim: string } {
    const trio = plantTrio(name);
    const claim = claimOn(trio.a, STORE_A);
    pushNewClaimBranch(trio.a, claim, BRANCH);
    fetchClaimBranches(trio.a);
    fetchClaimBranches(trio.b);
    return { trio, claim };
  }

  /** An ownership commit on `parent` in clone `git`, or a throw. */
  function ownershipOn(git: GitRunner, parent: string, action: 'release' | 'take', store: string): string {
    const made = makeOwnershipCommit(git, parent, { action, issue: 7, store });
    if (!made.ok) throw new Error(made.reason);
    return made.sha;
  }

  it('pushes an ownership commit whose lease is the remote tip', () => {
    const { trio, claim } = claimedTrio('lease-good');
    const release = ownershipOn(trio.a, claim, 'release', STORE_A);

    expect(pushOwnershipCommit(trio.a, release, BRANCH, claim)).toEqual({ outcome: 'pushed' });
    expect(remoteTip(trio)).toBe(release);
  });

  it('answers moved when another device moved the branch meanwhile, and changes nothing', () => {
    const { trio, claim } = claimedTrio('lease-stale');
    const release = ownershipOn(trio.a, claim, 'release', STORE_A);
    const take = ownershipOn(trio.b, claim, 'take', STORE_B);
    expect(pushOwnershipCommit(trio.a, release, BRANCH, claim)).toEqual({ outcome: 'pushed' });

    expect(pushOwnershipCommit(trio.b, take, BRANCH, claim)).toEqual({ outcome: 'moved' });
    expect(remoteTip(trio)).toBe(release);
  });

  it('answers moved when the branch was deleted meanwhile, and creates nothing', () => {
    const { trio, claim } = claimedTrio('lease-deleted');
    const take = ownershipOn(trio.b, claim, 'take', STORE_B);
    must(trio.origin, ['update-ref', '-d', `refs/heads/${BRANCH}`]);

    expect(pushOwnershipCommit(trio.b, take, BRANCH, claim)).toEqual({ outcome: 'moved' });
    expect(remoteTip(trio)).toBeNull();
  });

  it('refuses without pushing a commit that does not descend from the lease', () => {
    const { trio, claim } = claimedTrio('lease-drop');
    const calls: string[][] = [];
    const elsewhere = ownershipOn(trio.a, 'main', 'take', STORE_A);

    const answer = pushOwnershipCommit(recording(trio.a, calls), elsewhere, BRANCH, claim);

    expect(answer.outcome).toBe('failed');
    expect(reasonOf(answer)).toContain(`does not descend from ${claim}`);
    expect(calls.map((call) => call[0])).toEqual(['merge-base']);
    expect(remoteTip(trio)).toBe(claim);
  });

  it('answers failed with what git said when the remote cannot be reached', () => {
    const { trio, claim } = claimedTrio('lease-unreachable');
    const release = ownershipOn(trio.a, claim, 'release', STORE_A);
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const answer = pushOwnershipCommit(trio.a, release, BRANCH, claim);

    expect(answer.outcome).toBe('failed');
    expect(reasonOf(answer)).toContain('does not appear to be a git repository');
  });

  it('throws on a lease or a pushed commit that is not a full sha, before running git', () => {
    const calls: string[][] = [];
    const git = answering({ ok: true, stdout: '', stderr: '' }, calls);

    expect(() => pushOwnershipCommit(git, 'c'.repeat(40), BRANCH, 'main')).toThrow('the lease must be a full sha');
    expect(() => pushOwnershipCommit(git, 'c'.repeat(40), 'main', 'c'.repeat(40))).toThrow('is not a feat/rafa-* branch');
    expect(() => pushOwnershipCommit(git, '--all', BRANCH, 'c'.repeat(40))).toThrow('the pushed commit must be a full sha');
    expect(() => pushNewClaimBranch(git, '--all', BRANCH)).toThrow('the pushed commit must be a full sha');
    expect(calls).toEqual([]);
  });
});
