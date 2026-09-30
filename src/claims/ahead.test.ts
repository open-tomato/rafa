/**
 * Tests for claim ahead's own readings and its one push (`ahead.ts`).
 * The pair as `plan create` claims it, labels and answers included, is
 * `plan-claim.test.ts`'s.
 *
 * {@link pushClaimsAtomic} runs over a real bare repository and two
 * clones, `a` and `b`, standing for two devices; what the remote holds
 * is read off the bare repository itself, never through the clone that
 * pushed. Each "neither landed" reading keeps a control proving the
 * same ref lands when nothing stands in its way, so an absent branch is
 * the refusal's doing and not a push that could never have worked.
 */
import type { AheadCandidate, AheadRequest, AtomicClaimRef } from './ahead.js';
import type { RoadmapLine } from '../board/roadmap.js';
import type { GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { branchName } from '../board/naming.js';
import { createGitRunner } from '../pr/index.js';

import {
  aheadClaimedLine,
  aheadEnabled,
  aheadNotClaimedWarning,
  nextUndoneLine,
  pushClaimsAtomic,
  resolveAheadTarget,
} from './ahead.js';
import { makeOwnershipCommit } from './git.js';

const HOME = 'feat/rafa-7-home';
const AHEAD = 'feat/rafa-8-ahead';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-ahead-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

interface Trio {
  readonly origin: GitRunner;
  readonly originPath: string;
  readonly a: GitRunner;
  readonly b: GitRunner;
}

function cloneInto(originPath: string, dir: string, name: string): GitRunner {
  must(createGitRunner(scope), ['clone', '--quiet', originPath, dir]);
  const git = createGitRunner(dir);
  must(git, ['config', 'user.name', name]);
  must(git, ['config', 'user.email', `${name}@example.invalid`]);
  must(git, ['config', 'commit.gpgsign', 'false']);
  return git;
}

/** A bare remote whose `main` holds one commit, cloned twice. */
function plantTrio(name: string): Trio {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(scope), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seed = cloneInto(originPath, join(root, 'seed'), 'seed');
  must(seed, ['commit', '--quiet', '--allow-empty', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return {
    origin: createGitRunner(originPath),
    originPath,
    a: cloneInto(originPath, join(root, 'a'), 'device-a'),
    b: cloneInto(originPath, join(root, 'b'), 'device-b'),
  };
}

/** The remote's `branch`, read off the bare repository, or null. */
function remoteTip(trio: Trio, branch: string): string | null {
  const result = trio.origin(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** A claim commit by `store` on `issue`, made on `parent` in `git`. */
function claimCommit(git: GitRunner, parent: string, issue: number, store: string, action: 'claim' | 'take' = 'claim'): string {
  const made = makeOwnershipCommit(git, parent, { action, issue, store });
  if (!made.ok) throw new Error(made.reason);
  return made.sha;
}

/** A git runner that records every argv and runs none. */
function recorder(): { readonly git: GitRunner; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const git: GitRunner = (args) => {
    calls.push(args);
    return { ok: false, stdout: '', stderr: 'not run' };
  };
  return { git, calls };
}

function line(issue: number, ticked = false): RoadmapLine {
  return { issue, ticked, why: '', lineNumber: issue };
}

function candidate(overrides: Partial<AheadCandidate> = {}): AheadCandidate {
  return { issue: 8, title: 'Claim the next line', board: 1, labels: null, ...overrides };
}

function aheadRequest(overrides: Partial<AheadRequest> = {}): AheadRequest {
  return { flag: false, homeBoard: 1, candidate: candidate(), ...overrides };
}

describe('aheadEnabled', () => {
  it('runs under claims.ahead: allow or --claim-ahead, and not under off with no flag', () => {
    expect(aheadEnabled('off', false)).toBe(false);
    expect(aheadEnabled('off', true)).toBe(true);
    expect(aheadEnabled('allow', false)).toBe(true);
    expect(aheadEnabled('allow', true)).toBe(true);
  });
});

describe('nextUndoneLine', () => {
  it('answers the first line after home that is neither ticked nor closed, asking no further', async () => {
    const asked: number[] = [];
    const isClosed = (issue: number): Promise<boolean> => {
      asked.push(issue);
      return Promise.resolve(issue === 9);
    };
    const lines = [line(5), line(7), line(8, true), line(9), line(10), line(11)];

    const next = await nextUndoneLine(lines, 7, { isClosed });

    expect(next?.issue).toBe(10);
    expect(asked).toEqual([9, 10]);
  });

  it('answers a taken line, since taken is not done', async () => {
    const next = await nextUndoneLine([line(7), line(8)], 7, { isClosed: () => Promise.resolve(false) });

    expect(next?.issue).toBe(8);
  });

  it('answers null when home is not among the lines, or nothing after it is undone', async () => {
    const isClosed = (): Promise<boolean> => Promise.resolve(true);

    expect(await nextUndoneLine([line(5), line(8)], 7, { isClosed })).toBeNull();
    expect(await nextUndoneLine([line(7), line(8)], 7, { isClosed })).toBeNull();
    expect(await nextUndoneLine([line(7)], 7, { isClosed: () => Promise.resolve(false) })).toBeNull();
  });
});

describe('resolveAheadTarget', () => {
  it('names the branch a later plan create --issue would claim, on the home board', () => {
    const target = resolveAheadTarget(aheadRequest({ candidate: candidate({ labels: ['spec:ready'] }) }), 7);

    expect(target).toEqual({ ok: true, issue: 8, branch: branchName(8, 'Claim the next line'), labels: ['spec:ready'] });
    expect(target.ok && target.branch.startsWith('feat/rafa-8-')).toBe(true);
  });

  it('reports a line on another board as not claimed, naming both boards and #248', () => {
    const target = resolveAheadTarget(aheadRequest({ candidate: candidate({ board: 2 }) }), 7);

    if (target.ok) throw new Error('expected no target');
    expect(target.report).toEqual({
      outcome: 'not-claimed',
      issue: 8,
      cause: 'other-board',
      reason: '#8, the line ahead, was not claimed: it is on board #2 and #7 is on board #1;'
        + ' claiming across boards waits on the border setting (#248)',
    });
  });

  it('reports a line whose board or the home board was not read as not claimed', () => {
    const unread = resolveAheadTarget(aheadRequest({ candidate: candidate({ board: null }) }), 7);
    const noHome = resolveAheadTarget(aheadRequest({ homeBoard: null }), 7);

    expect(unread.ok
      ? null
      : unread.report).toMatchObject({ cause: 'other-board', reason: expect.stringContaining('its board was not read') });
    expect(noHome.ok
      ? null
      : noHome.report).toMatchObject({ cause: 'other-board', reason: expect.stringContaining('the board of #7 was not read') });
  });

  it('reports no line ahead when there is none, or the line is the home issue itself', () => {
    for (const request of [aheadRequest({ candidate: null }), aheadRequest({ candidate: candidate({ issue: 7 }) })]) {
      const target = resolveAheadTarget(request, 7);
      if (target.ok) throw new Error('expected no target');
      expect(target.report).toMatchObject({ outcome: 'not-claimed', issue: null, cause: 'no-line' });
    }
  });
});

describe('pushClaimsAtomic', () => {
  it('lands both claims in one push when both branches are free, and again as up to date', () => {
    const trio = plantTrio('both-free');
    const main = must(trio.a, ['rev-parse', 'main']);
    const refs: AtomicClaimRef[] = [
      { branch: HOME, sha: claimCommit(trio.a, main, 7, 'store-a'), lease: null },
      { branch: AHEAD, sha: claimCommit(trio.a, main, 8, 'store-a'), lease: null },
    ];

    expect(pushClaimsAtomic(trio.a, refs)).toEqual({ outcome: 'pushed' });
    expect(pushClaimsAtomic(trio.a, refs)).toEqual({ outcome: 'pushed' });
    expect(remoteTip(trio, HOME)).toBe(refs[0]?.sha ?? '');
    expect(remoteTip(trio, AHEAD)).toBe(refs[1]?.sha ?? '');
  });

  it('lands neither when another clone claimed one of the two, naming that branch', () => {
    const trio = plantTrio('one-taken');
    const main = must(trio.a, ['rev-parse', 'main']);
    const theirs = claimCommit(trio.b, main, 8, 'store-b');
    must(trio.b, ['push', '--quiet', 'origin', `${theirs}:refs/heads/${AHEAD}`]);
    const home: AtomicClaimRef = { branch: HOME, sha: claimCommit(trio.a, main, 7, 'store-a'), lease: null };

    const pair = pushClaimsAtomic(trio.a, [home, { branch: AHEAD, sha: claimCommit(trio.a, main, 8, 'store-a'), lease: null }]);

    expect(pair).toEqual({ outcome: 'refused', branch: AHEAD, by: 'claimed' });
    expect(remoteTip(trio, HOME)).toBeNull();
    expect(remoteTip(trio, AHEAD)).toBe(theirs);
    // Control: the home ref alone lands, so its absence above was the pair's refusal.
    expect(pushClaimsAtomic(trio.a, [home])).toEqual({ outcome: 'pushed' });
    expect(remoteTip(trio, HOME)).toBe(home.sha);
  });

  it('pushes a take with its lease, and refuses the pair as moved when the tip moved since', () => {
    const trio = plantTrio('lease');
    const main = must(trio.a, ['rev-parse', 'main']);
    const theirs = claimCommit(trio.b, main, 8, 'store-b');
    must(trio.b, ['push', '--quiet', 'origin', `${theirs}:refs/heads/${AHEAD}`]);
    must(trio.a, ['fetch', '--quiet', 'origin']);
    const take = claimCommit(trio.a, theirs, 8, 'store-a', 'take');
    const home: AtomicClaimRef = { branch: HOME, sha: claimCommit(trio.a, main, 7, 'store-a'), lease: null };
    const moved = claimCommit(trio.b, theirs, 8, 'store-b', 'take');
    must(trio.b, ['push', '--quiet', 'origin', `${moved}:refs/heads/${AHEAD}`]);

    const stale = pushClaimsAtomic(trio.a, [home, { branch: AHEAD, sha: take, lease: theirs }]);

    expect(stale).toEqual({ outcome: 'refused', branch: AHEAD, by: 'moved' });
    expect(remoteTip(trio, HOME)).toBeNull();
    must(trio.a, ['fetch', '--quiet', 'origin']);
    const retake = claimCommit(trio.a, moved, 8, 'store-a', 'take');
    expect(pushClaimsAtomic(trio.a, [home, { branch: AHEAD, sha: retake, lease: moved }])).toEqual({ outcome: 'pushed' });
    expect([remoteTip(trio, HOME), remoteTip(trio, AHEAD)]).toEqual([home.sha, retake]);
  });

  it('answers failed with what git said when the remote cannot be reached', () => {
    const trio = plantTrio('offline');
    const main = must(trio.a, ['rev-parse', 'main']);
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'no-such-remote.git')]);

    const pushed = pushClaimsAtomic(trio.a, [{ branch: HOME, sha: claimCommit(trio.a, main, 7, 'store-a'), lease: null }]);

    expect(pushed.outcome).toBe('failed');
    expect(pushed.outcome === 'failed'
      ? pushed.reason
      : '').toContain(`could not push ${HOME} to origin`);
  });

  it('refuses without pushing a lease the pushed commit does not descend from', () => {
    const trio = plantTrio('dropped');
    const main = must(trio.a, ['rev-parse', 'main']);
    const elsewhere = claimCommit(trio.a, main, 8, 'store-a');
    const unrelated = claimCommit(trio.a, main, 8, 'store-a', 'take');

    const pushed = pushClaimsAtomic(trio.a, [{ branch: AHEAD, sha: unrelated, lease: elsewhere }]);

    expect(pushed).toEqual({ outcome: 'failed', reason: `${unrelated} does not descend from ${elsewhere}, so pushing it would drop commits from ${AHEAD}` });
    expect(remoteTip(trio, AHEAD)).toBeNull();
  });

  it('refuses without running git refs that are none, doubled, not claim branches or not full shas', () => {
    const sha = 'a'.repeat(40);
    const { git, calls } = recorder();
    const cases: (readonly AtomicClaimRef[])[] = [
      [],
      [{ branch: HOME, sha, lease: null }, { branch: HOME, sha, lease: null }],
      [{ branch: 'main', sha, lease: null }],
      [{ branch: HOME, sha: 'abc123', lease: null }],
      [{ branch: HOME, sha, lease: 'HEAD' }],
    ];

    const outcomes = cases.map((refs) => pushClaimsAtomic(git, refs).outcome);

    expect(outcomes).toEqual(['failed', 'failed', 'failed', 'failed', 'failed']);
    expect(calls).toEqual([]);
  });
});

describe('the lines a run prints', () => {
  it('names a line ahead claimed, held already, and not claimed', () => {
    expect(aheadClaimedLine({ outcome: 'claimed', issue: 8, branch: AHEAD, via: 'claim' }))
      .toBe(`🔒 Claimed #8, the line ahead, on ${AHEAD}.`);
    expect(aheadClaimedLine({ outcome: 'claimed', issue: 8, branch: AHEAD, via: 'held' }))
      .toBe(`🔒 #8, the line ahead, is already claimed by this device on ${AHEAD}.`);
    expect(aheadNotClaimedWarning({ outcome: 'not-claimed', issue: 8, cause: 'taken', reason: 'why' }))
      .toBe('⚠️  Claim ahead: why');
  });
});
