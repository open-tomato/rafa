/**
 * Tests for the claim check of `loop start`'s preflight
 * (`start/preflight-claim.ts`), over a real bare repository and two
 * clones of it, `a` and `b`, standing for two devices. Every case plants
 * its own trio under this suite's temporary directory, so no case sees
 * another's refs.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed, so "the claim was pushed" and "nothing
 * was pushed" are readings of the remote. Each refusal sits beside a
 * control differing in one thing only (the store the device claims as,
 * the remote's reach, or whether a claim commit exists), so a check
 * that refused everything, or nothing, reddens one of the pair. The
 * board is the real `createGhIssueBoard` over a scripted `gh` runner
 * that records every argv.
 *
 * Eight mutations of `preflight-claim.ts` were driven against this file
 * and `preflight.test.ts` together on 2026-09-30, each restored
 * sha256-identical, and each reddened at least one case: a remote claim
 * read as owned whoever holds it (6), the offline guard of a waiting
 * claim dropped (1), the local tip pushed in place of the claim commit
 * (1), the swap sent on a resume (2), a claim only the local branch
 * carries read as none (5), a released remote passed (1), another
 * store's local claim passed (1), and a stub naming no issue checked
 * anyway (35).
 */
import type { RunClaim, StartPreflightClaim } from './preflight-claim.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RefreshConfig } from '../board/project/refresh.js';
import type { DeviceStoreId } from '../claims/device.js';
import type { GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createGhIssueBoard } from '../board/issue-board.js';
import { makeOwnershipCommit } from '../claims/git.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';
import { CommandExit } from '../cli/command.js';
import { createGitRunner } from '../pr/index.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { createStartPreflightClaim, markInDevelopment, readRunClaim, refuseUnownedClaim } from './preflight-claim.js';

const ISSUE = 7;
const STUB = 'rafa-7-claim-race';
const BRANCH = `feat/${STUB}`;
const PLAN = `/project/.rafa/plans/PLAN-${STUB}.md`;
const STORE_A = 'store-a';
const STORE_B = 'store-b';

/** The project refresh's keys, no project set: a label write sends no refresh. */
const NO_PROJECT: RefreshConfig = { boardProjectNumber: null, boardRelationships: 'labels', roadmapIssue: null, releaseFragments: '.changes' };

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-claim-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

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
  return {
    origin: createGitRunner(originPath),
    a: cloneInto(originPath, join(root, 'a'), 'device-a'),
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

/** The remote's claim branch, read off the bare repository. */
function remoteTip(trio: Trio): string | null {
  return tipAt(trio.origin, `refs/heads/${BRANCH}`);
}

/** An ownership commit by `store` on `parent`, or a throw. */
function ownershipOn(git: GitRunner, parent: string, action: 'claim' | 'release', store: string): string {
  const made = makeOwnershipCommit(git, parent, { action, issue: ISSUE, store });
  if (!made.ok) throw new Error(made.reason);
  return made.sha;
}

/** A claim commit by `store` pushed to the remote's claim branch from `git`. */
function pushClaim(git: GitRunner, store: string): string {
  const sha = ownershipOn(git, 'main', 'claim', store);
  must(git, ['push', '--quiet', 'origin', `${sha}:refs/heads/${BRANCH}`]);
  return sha;
}

/** A claim commit by `store` left on the clone's local claim branch, unpushed, as `plan create` offline leaves it. */
function leaveClaim(git: GitRunner, store: string): string {
  const sha = ownershipOn(git, 'main', 'claim', store);
  must(git, ['update-ref', `refs/heads/${BRANCH}`, sha]);
  return sha;
}

/** Points the clone's `origin` at a path that holds no repository. */
function goOffline(git: GitRunner): void {
  must(git, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);
}

/** The store id answer for `store`, or the NDJSON cause when null. */
function storeIdOf(store: string | null): DeviceStoreId {
  return store === null
    ? { ok: false, cause: 'ndjson', reason: 'NDJSON store; Next safe step: rafa effort move --to=sqlite' }
    : { ok: true, storeId: store };
}

/** The seams device `store` checks through, over `git`, recording each store read. */
function seamsOf(git: GitRunner, store: string | null, reads: string[] = []): StartPreflightClaim {
  return {
    git,
    board: null,
    readStoreId: () => {
      reads.push('read');
      return storeIdOf(store);
    },
  };
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

/** Runs `act` with the output captured, answering its info and warn lines. */
async function captured<T>(act: () => T | Promise<T>): Promise<{ readonly value: T; readonly info: string[]; readonly warn: string[] }> {
  const info: string[] = [];
  const warn: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
    warn: (message) => {
      warn.push(message);
    },
  }));
  try {
    return { value: await act(), info, warn };
  } finally {
    setActiveOutput(null);
  }
}

/** The refused answer's owner and reason, or a throw naming what was read instead. */
function refusal(claim: RunClaim): { readonly owner: string | null; readonly reason: string } {
  if (claim.outcome !== 'refused') throw new Error(`expected refused, read ${claim.outcome}`);
  return { owner: claim.owner, reason: claim.reason };
}

describe('a plan with no claim to check', () => {
  it('reads a stub naming no issue as none, running no git and reading no store', () => {
    const calls: (readonly string[])[] = [];
    const reads: string[] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      return { ok: false, stdout: '', stderr: 'no git expected' };
    };

    const planned = readRunClaim('/project/.rafa/plans/PLAN-demo.md', seamsOf(git, STORE_A, reads));
    const bare = readRunClaim('/project/PLAN.md', seamsOf(git, STORE_A, reads));

    expect([planned, bare]).toEqual([{ outcome: 'none' }, { outcome: 'none' }]);
    expect([calls, reads]).toEqual([[], []]);
  });

  it('reads an issue whose branch carries no claim commit as none, reading no store; a claimed control reads the store', () => {
    const trio = plantTrio('none');
    must(trio.b, ['push', '--quiet', 'origin', `main:refs/heads/${BRANCH}`]);
    const reads: string[] = [];
    const controlReads: string[] = [];

    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A, reads));
    const control = plantTrio('none-control');
    pushClaim(control.a, STORE_A);
    const controlClaim = readRunClaim(PLAN, seamsOf(control.a, STORE_A, controlReads));

    expect(claim).toEqual({ outcome: 'none' });
    expect(reads).toEqual([]);
    expect(controlClaim.outcome).toBe('owned');
    expect(controlReads).toEqual(['read']);
  });

  it('reads a clone with no remote and no claim commit as none', () => {
    const trio = plantTrio('no-remote');
    goOffline(trio.a);

    expect(readRunClaim(PLAN, seamsOf(trio.a, STORE_A))).toEqual({ outcome: 'none' });
  });
});

describe('a claim the remote holds', () => {
  it('owns a claim this store holds, pushing nothing', () => {
    const trio = plantTrio('held');
    const sha = pushClaim(trio.a, STORE_A);

    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'held', note: '' });
    expect(remoteTip(trio)).toBe(sha);
  });

  it('refuses a claim another store holds, naming it; the same remote read as that store owns it', () => {
    const trio = plantTrio('other');
    pushClaim(trio.a, STORE_A);

    const claim = readRunClaim(PLAN, seamsOf(trio.b, STORE_B));
    const control = readRunClaim(PLAN, seamsOf(trio.b, STORE_A));

    expect(refusal(claim)).toEqual({
      owner: STORE_A,
      reason: `#7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device (store ${STORE_B})`,
    });
    expect(control.outcome).toBe('owned');
  });

  it('refuses a device whose store names no claimant, naming the owner and why this device names none', () => {
    const trio = plantTrio('no-store-id');
    pushClaim(trio.a, STORE_A);

    const { owner, reason } = refusal(readRunClaim(PLAN, seamsOf(trio.b, null)));

    expect(owner).toBe(STORE_A);
    expect(reason).toContain(`#7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device, whose store names no claimant:`);
    expect(reason).toContain('rafa effort move --to=sqlite');
  });

  it('refuses a released claim, naming who released it; the claim before the release is owned', () => {
    const trio = plantTrio('released');
    const claim = pushClaim(trio.a, STORE_A);
    const before = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));
    const release = ownershipOn(trio.a, claim, 'release', STORE_A);
    must(trio.a, ['push', '--quiet', 'origin', `${release}:refs/heads/${BRANCH}`]);

    const after = refusal(readRunClaim(PLAN, seamsOf(trio.a, STORE_A)));

    expect(before.outcome).toBe('owned');
    expect(after).toEqual({
      owner: null,
      reason: `the claim on #7 was released on ${BRANCH} by store ${STORE_A}, so no device holds it and this run would hold no claim`,
    });
  });

  it('owns what the last fetch left on an unreachable remote, as unconfirmed; another store\'s last-read claim refuses', () => {
    const trio = plantTrio('unconfirmed');
    pushClaim(trio.a, STORE_A);
    must(trio.b, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
    readRunClaim(PLAN, seamsOf(trio.a, STORE_A));
    goOffline(trio.a);
    goOffline(trio.b);

    const own = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));
    const other = refusal(readRunClaim(PLAN, seamsOf(trio.b, STORE_B)));

    if (own.outcome !== 'owned') throw new Error(`expected owned, read ${own.outcome}`);
    expect(own.via).toBe('unconfirmed');
    expect(own.note).toContain('does not appear to be a git repository');
    expect(other.owner).toBe(STORE_A);
    expect(other.reason).toContain(', as the last fetch left it (could not fetch the feat/rafa-* branches from origin:');
  });
});

describe('a claim waiting unpushed on the local branch', () => {
  it('pushes it without moving the local branch, and owns it', () => {
    const trio = plantTrio('retry');
    const sha = leaveClaim(trio.a, STORE_A);
    expect(remoteTip(trio)).toBeNull();

    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'pushed', note: '' });
    expect(remoteTip(trio)).toBe(sha);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(sha);
  });

  it('pushes the claim commit, not the work after it', () => {
    const trio = plantTrio('retry-work');
    const sha = leaveClaim(trio.a, STORE_A);
    const work = must(trio.a, ['commit-tree', `${sha}^{tree}`, '-p', sha, '-m', 'feat: work']);
    must(trio.a, ['update-ref', `refs/heads/${BRANCH}`, work]);

    readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(remoteTip(trio)).toBe(sha);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(work);
  });

  it('refuses when another store pushed first, naming it and pushing nothing', () => {
    const trio = plantTrio('race');
    leaveClaim(trio.b, STORE_B);
    const theirs = pushClaim(trio.a, STORE_A);

    const { owner, reason } = refusal(readRunClaim(PLAN, seamsOf(trio.b, STORE_B)));

    expect(owner).toBe(STORE_A);
    expect(reason).toStartWith(`#7 is claimed by store ${STORE_A} on ${BRANCH}`);
    expect(remoteTip(trio)).toBe(theirs);
  });

  it('refuses while the remote cannot be reached, keeping the claim local; the reachable control pushes it', () => {
    const trio = plantTrio('offline');
    const sha = leaveClaim(trio.a, STORE_A);
    const calls: (readonly string[])[] = [];
    const recording: GitRunner = (args) => {
      calls.push(args);
      return trio.a(args);
    };
    goOffline(trio.a);

    const { owner, reason } = refusal(readRunClaim(PLAN, seamsOf(recording, STORE_A)));
    must(trio.a, ['remote', 'set-url', 'origin', must(trio.origin, ['rev-parse', '--absolute-git-dir'])]);
    const control = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(owner).toBeNull();
    expect(reason).toStartWith(`the claim on #7 waits unpushed on the local ${BRANCH} and could not be pushed: could not fetch`);
    expect(reason).toEndWith('\nRun rafa loop start again once origin is reachable');
    expect(calls.filter((call) => call[0] === 'push')).toEqual([]);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(sha);
    expect(control.outcome).toBe('owned');
    expect(remoteTip(trio)).toBe(sha);
  });

  it('refuses a local claim another store holds when the remote holds none', () => {
    const trio = plantTrio('local-other');
    leaveClaim(trio.a, STORE_B);

    const { owner, reason } = refusal(readRunClaim(PLAN, seamsOf(trio.a, STORE_A)));

    expect(owner).toBe(STORE_B);
    expect(reason).toBe(`#7 is claimed by store ${STORE_B} on the local ${BRANCH}, not by this device (store ${STORE_A})`);
    expect(remoteTip(trio)).toBeNull();
  });
});

describe('refuseUnownedClaim', () => {
  it('throws exit 1 naming the owner under one opening line, printing nothing', async () => {
    const trio = plantTrio('refuse');
    pushClaim(trio.a, STORE_A);

    const run = await captured(() => {
      try {
        refuseUnownedClaim(PLAN, seamsOf(trio.b, STORE_B));
        return null;
      } catch (error) {
        if (!(error instanceof CommandExit)) throw error;
        return error;
      }
    });

    expect(run.value?.exitCode).toBe(1);
    expect(run.value?.message).toBe([
      '❌ Refusing to start: this device does not own the claim on #7.',
      `   #7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device (store ${STORE_B})`,
      '   Nothing was checked and nothing was dispatched.',
    ].join('\n'));
    expect([run.info, run.warn]).toEqual([[], []]);
  });

  it('prints one info line for a pushed claim, and one warning for an unconfirmed one', async () => {
    const trio = plantTrio('lines');
    leaveClaim(trio.a, STORE_A);

    const pushed = await captured(() => refuseUnownedClaim(PLAN, seamsOf(trio.a, STORE_A)));
    goOffline(trio.a);
    const unconfirmed = await captured(() => refuseUnownedClaim(PLAN, seamsOf(trio.a, STORE_A)));

    expect([pushed.info, pushed.warn]).toEqual([[`🔒 Pushed the claim on #7 to origin/${BRANCH} for store ${STORE_A}.`], []]);
    expect(unconfirmed.info).toEqual([]);
    expect(unconfirmed.warn).toHaveLength(1);
    expect(unconfirmed.warn[0]).toStartWith('⚠️  Could not confirm the claim on #7: could not fetch');
    expect(unconfirmed.warn[0]).toEndWith(`the last fetch left ${BRANCH} held by this device (store ${STORE_A}), so the run goes on.`);
  });

  it('refuses a store whose id cannot be read, naming what its open threw', async () => {
    const trio = plantTrio('store-throws');
    pushClaim(trio.a, STORE_A);
    const seams: StartPreflightClaim = {
      git: trio.a,
      board: null,
      readStoreId: () => {
        throw new Error('database disk image is malformed');
      },
    };

    const run = await captured(() => {
      try {
        refuseUnownedClaim(PLAN, seams);
        return null;
      } catch (error) {
        if (!(error instanceof CommandExit)) throw error;
        return error;
      }
    });

    expect(run.value?.exitCode).toBe(1);
    expect(run.value?.message).toBe([
      '❌ Refusing to start: the store id to check the claim on #7 could not be read.',
      '   database disk image is malformed',
      '   Nothing was checked and nothing was dispatched.',
    ].join('\n'));
  });
});

describe('createStartPreflightClaim', () => {
  it('holds no board under pr.provider: none and reads the store id under the configured store; gh holds one', () => {
    const root = realpathSync(mkdtempSync(join(scope, 'factory-')));

    const none = createStartPreflightClaim(root, { prProvider: 'none', store: 'ndjson', ...NO_PROJECT });
    const gh = createStartPreflightClaim(root, { prProvider: 'gh', store: 'ndjson', ...NO_PROJECT });
    const storeId = none.readStoreId();

    expect(none.board).toBeNull();
    expect(gh.board).not.toBeNull();
    expect(storeId).toMatchObject({ ok: false, cause: 'ndjson' });
    expect(none.git(['rev-parse', '--is-inside-work-tree']).ok).toBe(false);
  });
});

describe('markInDevelopment', () => {
  const owned: RunClaim = { outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'held', note: '' };

  it('swaps the labels in one write on a first dispatch of an owned claim', async () => {
    const world = boardWorld();

    const run = await captured(() => markInDevelopment(owned, world.board, true));

    expect(world.calls).toEqual([
      ['issue', 'edit', '7', '--remove-label', CLAIMED_LABEL, '--add-label', IN_DEVELOPMENT_LABEL],
    ]);
    expect([run.info, run.warn]).toEqual([[], []]);
  });

  it('writes nothing on a resume, or for a run with no claim; the first-dispatch control writes', async () => {
    const world = boardWorld();

    await captured(() => markInDevelopment(owned, world.board, false));
    await captured(() => markInDevelopment({ outcome: 'none' }, world.board, true));
    const writtenBefore = world.calls.length;
    await captured(() => markInDevelopment(owned, world.board, true));

    expect(writtenBefore).toBe(0);
    expect(world.calls).toHaveLength(1);
  });

  it('warns when the board is not gh or refuses the write, and never throws', async () => {
    const failing = boardWorld(true);

    const noBoard = await captured(() => markInDevelopment(owned, null, true));
    const refused = await captured(() => markInDevelopment(owned, failing.board, true));

    expect(noBoard.warn).toEqual([
      `⚠️  claim labels: #7 was not moved from ${CLAIMED_LABEL} to ${IN_DEVELOPMENT_LABEL}: the board is not gh; the claim stands in git`,
    ]);
    expect(refused.warn).toHaveLength(1);
    expect(refused.warn[0]).toContain('label write refused');
    expect(failing.calls).toHaveLength(1);
  });
});
