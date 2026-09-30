/**
 * Tests for the claim a `plan create` run makes (`plan-claim.ts`), over
 * a real bare repository and two clones of it, `a` and `b`, standing for
 * two devices. Every case plants its own trio under this suite's
 * temporary directory, so no case sees another's refs.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed. The board is the real
 * `createGhIssueBoard` over a scripted `gh` runner that records every
 * argv, so "no label was written" is a reading of that record. Staleness
 * is reached by moving the clock (`now`) five days ahead rather than by
 * back-dating commits, and each stale case keeps a control whose only
 * difference is the clock, the labels or the setting.
 */
import type { AheadCandidate, AheadRequest } from './ahead.js';
import type { PlanClaim, PlanClaimContext, PlanClaimRequest } from './plan-claim.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhIssueBoard } from '../board/issue-board.js';
import { branchName } from '../board/naming.js';
import { createGitRunner } from '../pr/index.js';

import { makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from './git.js';
import { claimPlanIssue, resolveClaimTarget } from './plan-claim.js';
import { parseClaimMessage } from './record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from './stale.js';

const ISSUE = 7;
const STUB = 'rafa-7-claim-race';
const BRANCH = `feat/${STUB}`;
const STORE_A = 'store-a';
const STORE_B = 'store-b';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-claim-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

interface Trio {
  readonly origin: GitRunner;
  readonly originPath: string;
  readonly a: GitRunner;
  readonly aPath: string;
  readonly b: GitRunner;
}

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
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
  const seedPath = join(root, 'seed');
  const seed = cloneInto(originPath, seedPath, 'seed');
  writeFileSync(join(seedPath, 'kept.txt'), 'kept\n', 'utf8');
  must(seed, ['add', '--all']);
  must(seed, ['commit', '--quiet', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const aPath = join(root, 'a');
  return {
    origin: createGitRunner(originPath),
    originPath,
    a: cloneInto(originPath, aPath, 'device-a'),
    aPath,
    b: cloneInto(originPath, join(root, 'b'), 'device-b'),
  };
}

/** What `git` holds at `ref`, or null when it holds nothing there. */
function tipAt(git: GitRunner, ref: string): string | null {
  const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** The remote's `branch`, read off the bare repository. */
function remoteTip(trio: Trio, branch: string = BRANCH): string | null {
  return tipAt(trio.origin, `refs/heads/${branch}`);
}

/** The ownership record the commit `sha` carries, read off the bare repository. */
function recordAt(trio: Trio, sha: string): unknown {
  const reading = parseClaimMessage(must(trio.origin, ['log', '-1', '--format=%B', sha]));
  return reading.kind === 'ownership'
    ? reading.record
    : reading.kind;
}

/** A `gh` board that records every argv and fails every call when `failing`. */
function boardWorld(failing = false): { readonly board: ReturnType<typeof createGhIssueBoard>; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = async (args): Promise<GhResult> => {
    calls.push(args);
    return failing
      ? { ok: false, stdout: '', stderr: 'label write refused' }
      : { ok: true, stdout: '', stderr: '' };
  };
  return { board: createGhIssueBoard({ gh }), calls };
}

/** The request a `--issue 7` run with stub {@link STUB} makes, labels unread unless given. */
function request(overrides: Partial<PlanClaimRequest> = {}): PlanClaimRequest {
  return { issue: ISSUE, specPath: `.rafa/specs/${STUB}.md`, stub: STUB, labels: null, ...overrides };
}

/** The context device `store` claims through, over `git`. */
function context(git: GitRunner, store: string | null, overrides: Partial<PlanClaimContext> = {}): PlanClaimContext {
  return {
    git,
    board: null,
    readStoreId: () => store === null
      ? { ok: false, cause: 'ndjson', reason: 'NDJSON store; Next safe step: rafa effort move --to=sqlite' }
      : { ok: true, storeId: store },
    staleAfter: '3d',
    claimsAhead: 'off',
    now: new Date(),
    ...overrides,
  };
}

/** Pushes device a's claim on {@link BRANCH} through the module, or throws. */
async function claimByA(trio: Trio): Promise<string> {
  const answer = await claimPlanIssue(request(), context(trio.a, STORE_A));
  if (answer.outcome !== 'claimed') throw new Error(`expected a's claim, read ${JSON.stringify(answer)}`);
  return must(trio.origin, ['rev-parse', `refs/heads/${BRANCH}`]);
}

/** Pushes a release commit by device a on top of `tip`, or throws. */
function releaseByA(trio: Trio, tip: string): string {
  must(trio.a, ['fetch', '--quiet', 'origin']);
  const made = makeOwnershipCommit(trio.a, tip, { action: 'release', issue: ISSUE, store: STORE_A });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushOwnershipCommit(trio.a, made.sha, BRANCH, tip);
  if (pushed.outcome !== 'pushed') throw new Error(`release: ${JSON.stringify(pushed)}`);
  return made.sha;
}

/** The answer narrowed to one outcome, or a throw naming the one it had. */
function as<O extends PlanClaim['outcome']>(answer: PlanClaim, outcome: O): Extract<PlanClaim, { readonly outcome: O }> {
  if (answer.outcome !== outcome) throw new Error(`expected ${outcome}, read ${JSON.stringify(answer)}`);
  return answer as Extract<PlanClaim, { readonly outcome: O }>;
}

describe('resolveClaimTarget', () => {
  it('takes the issue the run read and the branch feat/<stub>', () => {
    expect(resolveClaimTarget(request())).toEqual({ ok: true, issue: ISSUE, branch: BRANCH });
  });

  it('reads the issue off a --spec basename opening rafa-<n>-', () => {
    const target = resolveClaimTarget(request({ issue: null, specPath: 'specs/rafa-7-claim-race.md' }));
    expect(target).toEqual({ ok: true, issue: ISSUE, branch: BRANCH });
  });

  it('answers unclaimed no-issue for a --spec naming no issue', () => {
    const target = resolveClaimTarget(request({ issue: null, specPath: 'specs/my-feature.md', stub: 'my-feature' }));
    if (target.ok) throw new Error('expected no target');
    expect(as(target.answer, 'unclaimed').cause).toBe('no-issue');
  });

  it('answers unclaimed branch-mismatch for a --stub naming no issue or another one', () => {
    for (const stub of ['my-feature', 'rafa-70-claim-race']) {
      const target = resolveClaimTarget(request({ stub }));
      if (target.ok) throw new Error(`expected no target for ${stub}`);
      const answer = as(target.answer, 'unclaimed');
      expect(answer.cause).toBe('branch-mismatch');
      expect(answer.reason).toContain(`feat/${stub}`);
      expect(answer.reason).toContain('--stub=rafa-7-<slug>');
    }
  });
});

describe('claimPlanIssue: before any git', () => {
  it('answers unclaimed with the store\'s reason, running no git, when the device has no store id', async () => {
    const calls: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      return { ok: false, stdout: '', stderr: 'not run' };
    };

    const answer = as(await claimPlanIssue(request(), context(git, null)), 'unclaimed');

    expect(answer.cause).toBe('no-store-id');
    expect(answer.reason).toContain('rafa effort move --to=sqlite');
    expect(calls).toEqual([]);
  });
});

describe('claimPlanIssue: a fresh claim', () => {
  it('pushes one claim commit naming the store, labels the issue, and touches no local branch', async () => {
    const trio = plantTrio('fresh');
    const { board, calls } = boardWorld();
    const main = must(trio.a, ['rev-parse', 'main']);

    const answer = await claimPlanIssue(request(), context(trio.a, STORE_A, { board }));

    expect(answer).toEqual({ outcome: 'claimed', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'claim', warnings: [] });
    const tip = remoteTip(trio);
    if (tip === null) throw new Error('the claim did not land');
    expect(recordAt(trio, tip)).toEqual({ action: 'claim', issue: ISSUE, store: STORE_A });
    expect(must(trio.origin, ['rev-parse', `${tip}^`])).toBe(main);
    expect(calls).toEqual([['issue', 'edit', String(ISSUE), '--add-label', CLAIMED_LABEL]]);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBeNull();
    expect(tipAt(trio.a, `refs/remotes/origin/${BRANCH}`)).toBe(tip);
  });

  it('refuses the second device, naming the first store, and leaves the remote and the board alone', async () => {
    const trio = plantTrio('race');
    const tip = await claimByA(trio);
    const { board, calls } = boardWorld();

    const answer = as(await claimPlanIssue(request(), context(trio.b, STORE_B, { board })), 'refused');

    expect(answer.owner).toBe(STORE_A);
    expect(answer.branch).toBe(BRANCH);
    expect(answer.reason).toContain(`#${String(ISSUE)} is claimed by store ${STORE_A} on ${BRANCH}`);
    expect(remoteTip(trio)).toBe(tip);
    expect(calls).toEqual([]);
  });

  it('answers held and pushes nothing when this store already holds the claim', async () => {
    const trio = plantTrio('held');
    const tip = await claimByA(trio);

    const answer = await claimPlanIssue(request(), context(trio.a, STORE_A));

    expect(as(answer, 'claimed').via).toBe('held');
    expect(remoteTip(trio)).toBe(tip);
  });

  it('makes the claim commit on a local feat/<stub> and fast-forwards it, so its work reaches the remote', async () => {
    const trio = plantTrio('local-work');
    must(trio.a, ['switch', '--quiet', '-c', BRANCH]);
    must(trio.a, ['commit', '--quiet', '--allow-empty', '-m', 'work']);
    const work = must(trio.a, ['rev-parse', 'HEAD']);
    const { board } = boardWorld();

    const answer = await claimPlanIssue(request(), context(trio.a, STORE_A, { board }));

    expect(as(answer, 'claimed').warnings).toEqual([]);
    const tip = remoteTip(trio);
    if (tip === null) throw new Error('the claim did not land');
    expect(must(trio.origin, ['rev-parse', `${tip}^`])).toBe(work);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(tip);
    expect(trio.a(['status', '--porcelain']).stdout).toBe('');
  });

  it('keeps the claim when the label write fails, carrying the failure as a warning', async () => {
    const trio = plantTrio('label-fails');
    const { board } = boardWorld(true);

    const answer = as(await claimPlanIssue(request(), context(trio.a, STORE_A, { board })), 'claimed');

    expect(answer.warnings).toHaveLength(1);
    expect(answer.warnings[0]).toContain('label write refused');
    expect(remoteTip(trio)).not.toBeNull();
  });
});

describe('claimPlanIssue: taking a released or stale branch', () => {
  it('pushes a take commit on a released branch, keeping every commit on it', async () => {
    const trio = plantTrio('released');
    const released = releaseByA(trio, await claimByA(trio));

    const answer = await claimPlanIssue(request(), context(trio.b, STORE_B));

    expect(as(answer, 'claimed').via).toBe('take');
    const tip = remoteTip(trio);
    if (tip === null) throw new Error('the branch is gone');
    expect(recordAt(trio, tip)).toEqual({ action: 'take', issue: ISSUE, store: STORE_B });
    expect(must(trio.origin, ['rev-parse', `${tip}^`])).toBe(released);
  });

  it('takes over a stale rafa:claimed claim without writing the label it already carries', async () => {
    const trio = plantTrio('stale-claimed');
    const tip = await claimByA(trio);
    const { board, calls } = boardWorld();
    const later = new Date(Date.now() + FIVE_DAYS_MS);

    const answer = await claimPlanIssue(request({ labels: [CLAIMED_LABEL] }), context(trio.b, STORE_B, { board, now: later }));

    expect(as(answer, 'claimed').via).toBe('take');
    expect(must(trio.origin, ['rev-parse', `refs/heads/${BRANCH}^`])).toBe(tip);
    expect(calls).toEqual([]);
  });

  it('refuses the same claim while it is fresh, in development, or under staleAfter: disabled', async () => {
    const trio = plantTrio('stale-controls');
    const tip = await claimByA(trio);
    const later = new Date(Date.now() + FIVE_DAYS_MS);
    const controls: { readonly labels: readonly string[]; readonly overrides: Partial<PlanClaimContext> }[] = [
      { labels: [CLAIMED_LABEL], overrides: {} },
      { labels: [IN_DEVELOPMENT_LABEL], overrides: { now: later } },
      { labels: [CLAIMED_LABEL], overrides: { now: later, staleAfter: 'disabled' } },
    ];

    for (const { labels, overrides } of controls) {
      const answer = as(await claimPlanIssue(request({ labels }), context(trio.b, STORE_B, overrides)), 'refused');
      expect(answer.owner).toBe(STORE_A);
    }
    expect(remoteTip(trio)).toBe(tip);
  });

  it('names a stale in-development claim as never taken over automatically', async () => {
    const trio = plantTrio('stale-dev');
    await claimByA(trio);
    const later = new Date(Date.now() + FIVE_DAYS_MS);

    const answer = as(await claimPlanIssue(request({ labels: [IN_DEVELOPMENT_LABEL] }), context(trio.b, STORE_B, { now: later })), 'refused');

    expect(answer.reason).toContain('never taken over automatically');
  });

  it('refuses naming the new owner when the branch moves between the reading and the take', async () => {
    const trio = plantTrio('moved');
    const released = releaseByA(trio, await claimByA(trio));
    const raced: GitRunner = (args) => {
      if (args[0] === 'push' && args.some((arg) => arg.startsWith('--force-with-lease='))) {
        const made = makeOwnershipCommit(trio.a, released, { action: 'take', issue: ISSUE, store: 'store-c' });
        if (!made.ok) throw new Error(made.reason);
        const pushed = pushOwnershipCommit(trio.a, made.sha, BRANCH, released);
        if (pushed.outcome !== 'pushed') throw new Error(`race: ${JSON.stringify(pushed)}`);
      }
      return trio.b(args);
    };

    const answer = as(await claimPlanIssue(request(), context(raced, STORE_B)), 'refused');

    expect(answer.owner).toBe('store-c');
    expect(answer.reason).toContain('moved on origin');
    const tip = remoteTip(trio);
    if (tip === null) throw new Error('the branch is gone');
    expect(recordAt(trio, tip)).toEqual({ action: 'take', issue: ISSUE, store: 'store-c' });
  });
});

describe('claimPlanIssue: branches that keep the issue taken', () => {
  it('refuses, naming no owner, a feat/<stub> the remote holds with no claim commit', async () => {
    const trio = plantTrio('no-claim');
    must(trio.a, ['push', '--quiet', 'origin', `main:refs/heads/${BRANCH}`]);

    const answer = as(await claimPlanIssue(request(), context(trio.b, STORE_B)), 'refused');

    expect(answer.owner).toBeNull();
    expect(answer.reason).toContain('carrying no claim commit');
  });

  it('refuses a claim held on another branch of the issue, and passes one that was released', async () => {
    const trio = plantTrio('other-branch');
    const other = 'feat/rafa-7-other-name';
    const made = makeOwnershipCommit(trio.a, 'main', { action: 'claim', issue: ISSUE, store: STORE_A });
    if (!made.ok) throw new Error(made.reason);
    expect(pushNewClaimBranch(trio.a, made.sha, other).outcome).toBe('pushed');

    const held = as(await claimPlanIssue(request(), context(trio.b, STORE_B)), 'refused');
    expect(held.owner).toBe(STORE_A);
    expect(held.branch).toBe(other);
    expect(remoteTip(trio)).toBeNull();

    const release = makeOwnershipCommit(trio.a, made.sha, { action: 'release', issue: ISSUE, store: STORE_A });
    if (!release.ok) throw new Error(release.reason);
    expect(pushOwnershipCommit(trio.a, release.sha, other, made.sha).outcome).toBe('pushed');

    expect(as(await claimPlanIssue(request(), context(trio.b, STORE_B)), 'claimed').via).toBe('claim');
    expect(remoteTip(trio)).not.toBeNull();
  });

  it('refuses a stale claim on another branch, naming the stub to take it over under', async () => {
    const trio = plantTrio('other-stale');
    const other = 'feat/rafa-7-other-name';
    const made = makeOwnershipCommit(trio.a, 'main', { action: 'claim', issue: ISSUE, store: STORE_A });
    if (!made.ok) throw new Error(made.reason);
    expect(pushNewClaimBranch(trio.a, made.sha, other).outcome).toBe('pushed');
    const later = new Date(Date.now() + FIVE_DAYS_MS);

    const answer = as(await claimPlanIssue(request({ labels: [CLAIMED_LABEL] }), context(trio.b, STORE_B, { now: later })), 'refused');

    expect(answer.reason).toContain('--stub=rafa-7-other-name');
    expect(remoteTip(trio, other)).toBe(made.sha);
  });
});

describe('claimPlanIssue: no push', () => {
  it('leaves the claim commit on a local branch with no upstream when the remote is unreachable, and pushes that same commit later', async () => {
    const trio = plantTrio('offline');
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'no-such-remote.git')]);

    const first = as(await claimPlanIssue(request(), context(trio.a, STORE_A)), 'unclaimed');
    const again = as(await claimPlanIssue(request(), context(trio.a, STORE_A)), 'unclaimed');

    expect(first.cause).toBe('offline');
    const sha = first.pending?.sha ?? '';
    expect(first.pending).toEqual({ branch: BRANCH, sha });
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(sha);
    expect(trio.a(['rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`]).ok).toBe(false);
    expect(again.pending?.sha).toBe(sha);

    must(trio.a, ['remote', 'set-url', 'origin', trio.originPath]);
    expect(as(await claimPlanIssue(request(), context(trio.a, STORE_A)), 'claimed').via).toBe('claim');
    expect(remoteTip(trio)).toBe(sha);
  });

  it('answers push-failed with the commit pending when the remote refuses the push for another reason', async () => {
    const trio = plantTrio('hook');
    writeFileSync(join(trio.originPath, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    const answer = as(await claimPlanIssue(request(), context(trio.a, STORE_A)), 'unclaimed');

    expect(answer.cause).toBe('push-failed');
    expect(answer.reason).toContain('pre-receive hook declined');
    expect(answer.pending?.branch).toBe(BRANCH);
    expect(remoteTip(trio)).toBeNull();
  });
});

const AHEAD_ISSUE = 8;
const AHEAD_TITLE = 'Claim the next line';
const AHEAD_BRANCH = branchName(AHEAD_ISSUE, AHEAD_TITLE);

/** The ahead request of a walk whose next undone line is #8, on the home issue's board unless given. */
function aheadOf(overrides: Partial<AheadRequest> = {}, candidate: Partial<AheadCandidate> = {}): AheadRequest {
  return {
    flag: false,
    homeBoard: 1,
    candidate: { issue: AHEAD_ISSUE, title: AHEAD_TITLE, board: 1, labels: null, ...candidate },
    ...overrides,
  };
}

/** The context of device `store` with `claims.ahead: allow`. */
function aheadContext(git: GitRunner, store: string, overrides: Partial<PlanClaimContext> = {}): PlanClaimContext {
  return context(git, store, { claimsAhead: 'allow', ...overrides });
}

/** Pushes a claim by `store` on the line ahead from `git`, or throws; answers its sha. */
function claimAheadBy(trio: Trio, git: GitRunner, store: string): string {
  const main = must(git, ['rev-parse', 'origin/main']);
  const made = makeOwnershipCommit(git, main, { action: 'claim', issue: AHEAD_ISSUE, store });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(git, made.sha, AHEAD_BRANCH);
  if (pushed.outcome !== 'pushed') throw new Error(`ahead claim: ${JSON.stringify(pushed)}`);
  return must(trio.origin, ['rev-parse', `refs/heads/${AHEAD_BRANCH}`]);
}

/** `git`, running `before` once, just before its first `push --atomic`. */
function racing(git: GitRunner, before: () => void): { readonly git: GitRunner; readonly pushes: (readonly string[])[] } {
  const pushes: (readonly string[])[] = [];
  const wrapped: GitRunner = (args) => {
    if (args[0] === 'push' && args.includes('--atomic')) {
      if (pushes.length === 0) before();
      pushes.push(args);
    }
    return git(args);
  };
  return { git: wrapped, pushes };
}

describe('claimPlanIssue: claim ahead', () => {
  it('claims the home issue alone, reporting nothing ahead, while claims.ahead is off and no flag is given', async () => {
    const trio = plantTrio('ahead-off');
    const { board, calls } = boardWorld();

    const answer = await claimPlanIssue(request({ ahead: aheadOf() }), context(trio.a, STORE_A, { board }));

    expect(answer).toEqual({ outcome: 'claimed', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'claim', warnings: [] });
    expect(remoteTip(trio)).not.toBeNull();
    expect(remoteTip(trio, AHEAD_BRANCH)).toBeNull();
    expect(calls).toEqual([['issue', 'edit', String(ISSUE), '--add-label', CLAIMED_LABEL]]);
  });

  it('lands both claims in one atomic push and labels both, under claims.ahead: allow', async () => {
    const trio = plantTrio('ahead-both');
    const { board, calls } = boardWorld();
    const { git, pushes } = racing(trio.a, () => undefined);

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(git, STORE_A, { board })), 'claimed');

    expect(answer.via).toBe('claim');
    expect(answer.ahead).toEqual({ outcome: 'claimed', issue: AHEAD_ISSUE, branch: AHEAD_BRANCH, via: 'claim' });
    expect(answer.warnings).toEqual([]);
    expect(pushes).toHaveLength(1);
    const [home, ahead] = [remoteTip(trio), remoteTip(trio, AHEAD_BRANCH)];
    if (home === null || ahead === null) throw new Error('a claim of the pair did not land');
    expect(recordAt(trio, home)).toEqual({ action: 'claim', issue: ISSUE, store: STORE_A });
    expect(recordAt(trio, ahead)).toEqual({ action: 'claim', issue: AHEAD_ISSUE, store: STORE_A });
    expect(calls).toEqual([
      ['issue', 'edit', String(ISSUE), '--add-label', CLAIMED_LABEL],
      ['issue', 'edit', String(AHEAD_ISSUE), '--add-label', CLAIMED_LABEL],
    ]);
    expect(tipAt(trio.a, `refs/remotes/origin/${AHEAD_BRANCH}`)).toBe(ahead);
  });

  it('runs under --claim-ahead with claims.ahead: off', async () => {
    const trio = plantTrio('ahead-flag');

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf({ flag: true }) }), context(trio.a, STORE_A)), 'claimed');

    expect(answer.ahead?.outcome).toBe('claimed');
    expect(remoteTip(trio, AHEAD_BRANCH)).not.toBeNull();
  });

  it('lands neither when another device holds the line ahead, keeping the home claim on the local branch', async () => {
    const trio = plantTrio('ahead-taken');
    const theirs = claimAheadBy(trio, trio.b, STORE_B);
    const { board, calls } = boardWorld();

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(trio.a, STORE_A, { board })), 'unclaimed');

    expect(answer.cause).toBe('ahead-taken');
    expect(answer.reason).toContain('claim ahead takes both claims or neither');
    expect(answer.reason).toContain(`#${String(AHEAD_ISSUE)} is claimed by store ${STORE_B}`);
    expect(answer.ahead).toMatchObject({ outcome: 'not-claimed', issue: AHEAD_ISSUE, cause: 'taken' });
    expect(remoteTip(trio)).toBeNull();
    expect(remoteTip(trio, AHEAD_BRANCH)).toBe(theirs);
    expect(answer.pending?.branch).toBe(BRANCH);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(answer.pending?.sha ?? '');
    expect(calls).toEqual([]);
  });

  it('lands neither when the line ahead is claimed between the reading and the atomic push', async () => {
    const trio = plantTrio('ahead-race');
    let theirs = '';
    const { git, pushes } = racing(trio.a, () => {
      theirs = claimAheadBy(trio, trio.b, STORE_B);
    });

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(git, STORE_A)), 'unclaimed');

    expect(pushes).toHaveLength(1);
    expect(answer.cause).toBe('ahead-taken');
    expect(answer.ahead).toMatchObject({ cause: 'taken', reason: expect.stringContaining(`store ${STORE_B}`) });
    expect(remoteTip(trio)).toBeNull();
    expect(remoteTip(trio, AHEAD_BRANCH)).toBe(theirs);
  });

  it('refuses the run, naming the new owner, when the home issue is claimed between the reading and the atomic push', async () => {
    const trio = plantTrio('home-race');
    const raced = racing(trio.a, () => {
      const main = must(trio.b, ['rev-parse', 'origin/main']);
      const made = makeOwnershipCommit(trio.b, main, { action: 'claim', issue: ISSUE, store: STORE_B });
      if (!made.ok) throw new Error(made.reason);
      must(trio.b, ['push', '--quiet', 'origin', `${made.sha}:refs/heads/${BRANCH}`]);
    });

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(raced.git, STORE_A)), 'refused');

    expect(answer.owner).toBe(STORE_B);
    expect(remoteTip(trio, AHEAD_BRANCH)).toBeNull();
  });

  it('claims the home issue alone and reports a line ahead on another board as not claimed', async () => {
    const trio = plantTrio('ahead-board');

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf({}, { board: 2 }) }), aheadContext(trio.a, STORE_A)), 'claimed');

    expect(answer.via).toBe('claim');
    expect(answer.ahead).toMatchObject({ outcome: 'not-claimed', issue: AHEAD_ISSUE, cause: 'other-board' });
    expect(remoteTip(trio)).not.toBeNull();
    expect(remoteTip(trio, AHEAD_BRANCH)).toBeNull();
  });

  it('claims the home issue alone and reports no line ahead when the walk found none', async () => {
    const trio = plantTrio('ahead-none');

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf({ candidate: null }) }), aheadContext(trio.a, STORE_A)), 'claimed');

    expect(answer.ahead).toMatchObject({ outcome: 'not-claimed', issue: null, cause: 'no-line' });
    expect(remoteTip(trio)).not.toBeNull();
  });

  it('pushes the home claim alone when this store already holds the line ahead', async () => {
    const trio = plantTrio('ahead-held');
    const ours = claimAheadBy(trio, trio.a, STORE_A);

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(trio.a, STORE_A)), 'claimed');

    expect(answer.ahead).toEqual({ outcome: 'claimed', issue: AHEAD_ISSUE, branch: AHEAD_BRANCH, via: 'held' });
    expect(remoteTip(trio)).not.toBeNull();
    expect(remoteTip(trio, AHEAD_BRANCH)).toBe(ours);
  });

  it('pushes the line ahead alone when this store already holds the home issue, and keeps the home claim when it is taken', async () => {
    const free = plantTrio('home-held');
    const home = await claimByA(free);
    const taken = plantTrio('home-held-taken');
    const takenHome = await claimByA(taken);
    claimAheadBy(taken, taken.b, STORE_B);

    const landed = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(free.a, STORE_A)), 'claimed');
    const kept = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(taken.a, STORE_A)), 'claimed');

    expect([landed.via, landed.ahead?.outcome]).toEqual(['held', 'claimed']);
    expect(remoteTip(free)).toBe(home);
    expect(remoteTip(free, AHEAD_BRANCH)).not.toBeNull();
    expect([kept.via, kept.ahead?.outcome]).toEqual(['held', 'not-claimed']);
    expect(remoteTip(taken)).toBe(takenHome);
  });

  it('takes over a released line ahead with a take commit leased on its tip', async () => {
    const trio = plantTrio('ahead-released');
    const theirs = claimAheadBy(trio, trio.b, STORE_B);
    const release = makeOwnershipCommit(trio.b, theirs, { action: 'release', issue: AHEAD_ISSUE, store: STORE_B });
    if (!release.ok) throw new Error(release.reason);
    expect(pushOwnershipCommit(trio.b, release.sha, AHEAD_BRANCH, theirs).outcome).toBe('pushed');

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(trio.a, STORE_A)), 'claimed');

    expect(answer.ahead).toMatchObject({ outcome: 'claimed', via: 'take' });
    const tip = remoteTip(trio, AHEAD_BRANCH);
    if (tip === null) throw new Error('the take did not land');
    expect(recordAt(trio, tip)).toEqual({ action: 'take', issue: AHEAD_ISSUE, store: STORE_A });
    expect(must(trio.origin, ['rev-parse', `${tip}^`])).toBe(release.sha);
  });

  it('reports the line ahead as not tried when the remote cannot be reached', async () => {
    const trio = plantTrio('ahead-offline');
    must(trio.a, ['remote', 'set-url', 'origin', join(scope, 'no-such-remote.git')]);

    const answer = as(await claimPlanIssue(request({ ahead: aheadOf() }), aheadContext(trio.a, STORE_A)), 'unclaimed');

    expect(answer.cause).toBe('offline');
    expect(answer.ahead).toMatchObject({ outcome: 'not-claimed', issue: AHEAD_ISSUE, cause: 'not-tried' });
    expect(tipAt(trio.a, `refs/heads/${AHEAD_BRANCH}`)).toBeNull();
  });
});
