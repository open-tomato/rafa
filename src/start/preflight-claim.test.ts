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
 *
 * The re-sign's cases plant what the push meets with real git: a
 * `pre-receive` hook in the bare repository for a push git refuses, and
 * a runner that lets clone `b` push to the claim branch just before
 * clone `a`'s leased push for a tip that moved. Only the commit that
 * could not be made is scripted, since real git makes it.
 *
 * Seven mutations of the re-sign were driven against this file alone on
 * 2026-10-11, each restored sha256-identical, and each reddened at least
 * one case: a replaced holder read as held with no re-sign (9), the
 * re-sign's offline guard dropped (2), no second reading after a moved
 * tip (3), a second reading with no bound (1), the take commit naming
 * the replaced id (5), a refused push read as a moved tip (1), and a
 * claim that could not be re-signed printed at `info` (1).
 *
 * The cases of a store id minted after the claim date their commits
 * through `GIT_COMMITTER_DATE`, which the runner hands git from this
 * process's environment, so the claim, the tip and the mint are three
 * known moments and the refusal's text is asserted whole. Every other
 * case's store is minted on 2026-01-01, before any commit a case makes,
 * so none of them reads the sentence.
 *
 * Five mutations of that sentence were driven against this file alone
 * on 2026-10-11, each restored sha256-identical, and each reddened at
 * least one case: a mint in the claim's very second read as after it
 * (1), the stale date counted from no tip date (2), `disabled` read as
 * a duration (1), the claim dated by the tip in place of its latest
 * ownership commit (5), and the sentence added whenever the claim's
 * date could be read (6).
 */
import type { RunClaim, StartPreflightClaim } from './preflight-claim.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RefreshConfig } from '../board/project/refresh.js';
import type { DeviceStoreId } from '../claims/device.js';
import type { ClaimsStaleAfter } from '../config-sections.js';
import type { GitRunner } from '../pr/index.js';

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createGhIssueBoard } from '../board/issue-board.js';
import { readDeviceStoreId } from '../claims/device.js';
import { makeOwnershipCommit, readLocalClaimBranch } from '../claims/git.js';
import { parseClaimMessage } from '../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';
import { CommandExit } from '../cli/command.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/index.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { createStartPreflightClaim, markInDevelopment, readRunClaim, refuseUnownedClaim } from './preflight-claim.js';

const ISSUE = 7;
const STUB = 'rafa-7-claim-race';
const BRANCH = `feat/${STUB}`;
const PLAN = `/project/.rafa/plans/PLAN-${STUB}.md`;
const STORE_A = 'store-a';
const STORE_B = 'store-b';
/** An id store `a` carried before it re-minted in place. */
const STORE_A_REPLACED = 'store-a-replaced';

/** The project refresh's keys, no project set: a label write sends no refresh. */
const NO_PROJECT: RefreshConfig = { boardProjectNumber: null, boardProjectRetries: false, boardProjectRetryWaitSeconds: 1, boardProjectWriteBatchSize: 5, boardProjectWritePauseMs: 0, boardRelationships: 'labels', roadmapIssue: null, releaseFragments: '.changes' };

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-preflight-claim-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

interface Trio {
  readonly origin: GitRunner;
  readonly a: GitRunner;
  readonly b: GitRunner;
  /** Clone `a`'s directory, where its effort store sits under `.rafa/effort/`. */
  readonly aRoot: string;
  /** Clone `b`'s directory. */
  readonly bRoot: string;
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
  const aRoot = join(root, 'a');
  const bRoot = join(root, 'b');
  return {
    origin: createGitRunner(originPath),
    a: cloneInto(originPath, aRoot, 'device-a'),
    b: cloneInto(originPath, bRoot, 'device-b'),
    aRoot,
    bRoot,
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
function ownershipOn(git: GitRunner, parent: string, action: 'claim' | 'release' | 'take', store: string): string {
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

/** Points the clone's `origin` back at the trio's bare repository. */
function goOnline(trio: Trio, git: GitRunner): void {
  must(git, ['remote', 'set-url', 'origin', must(trio.origin, ['rev-parse', '--absolute-git-dir'])]);
}

/** What the remote's latest ownership commit records, read off the bare repository, or null when it carries none. */
function remoteRecord(trio: Trio): unknown {
  const reading = readLocalClaimBranch(trio.origin, BRANCH);
  if (reading.state !== 'found') throw new Error(`expected the remote's ${BRANCH}, read ${reading.state}`);
  const latest = reading.commits.at(-1);
  if (latest === undefined) return null;
  const parsed = parseClaimMessage(latest.message);
  return parsed.kind === 'ownership'
    ? parsed.record
    : parsed;
}

/** The one parent of the commit `sha`, read off the bare repository. */
function parentOf(trio: Trio, sha: string | null): string {
  return must(trio.origin, ['rev-parse', '--verify', `${String(sha)}^1`]);
}

/** Makes the bare repository refuse every push, through a `pre-receive` hook that exits 1. */
function refusePushes(trio: Trio): void {
  const hooks = join(must(trio.origin, ['rev-parse', '--absolute-git-dir']), 'hooks');
  const hook = join(hooks, 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "refused by the planted hook" >&2\nexit 1\n', 'utf8');
  chmodSync(hook, 0o755);
  must(trio.origin, ['config', 'core.hooksPath', hooks]);
}

/** A commit `make` builds on the remote's tip, pushed to the claim branch from clone `b`. */
function pushFromB(trio: Trio, make: (tip: string) => string): string {
  must(trio.b, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  const tip = remoteTip(trio);
  if (tip === null) throw new Error(`the remote holds no ${BRANCH} to push onto`);
  const sha = make(tip);
  must(trio.b, ['push', '--quiet', 'origin', `${sha}:refs/heads/${BRANCH}`]);
  return sha;
}

/** A work commit on the remote's tip, pushed from clone `b`. */
function pushWorkFromB(trio: Trio): string {
  return pushFromB(trio, (tip) => must(trio.b, ['commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'feat: work']));
}

/** True for the leased push of an ownership commit. */
function isLeasedPush(args: readonly string[]): boolean {
  return args[0] === 'push' && args.some((arg) => arg.startsWith('--force-with-lease='));
}

/**
 * Clone `a`'s runner, recording every argv, with `meanwhile` run just
 * before each of its first `times` leased pushes: what another device
 * pushes between this device's fetch and its push.
 */
function racing(trio: Trio, times: number, meanwhile: () => void): { readonly git: GitRunner; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  let raced = 0;
  const git: GitRunner = (args) => {
    if (isLeasedPush(args) && raced < times) {
      raced += 1;
      meanwhile();
    }
    calls.push(args);
    return trio.a(args);
  };
  return { git, calls };
}

/** The owned answer, or a throw naming what was read instead. */
function owned(claim: RunClaim): Extract<RunClaim, { outcome: 'owned' }> {
  if (claim.outcome !== 'owned') throw new Error(`expected owned, read ${claim.outcome}`);
  return claim;
}

/** The project every store this suite mints on disk records, since reading git in a clone would read its own commits. */
const STORE_PROJECT = 'root-commit-preflight-claim-store';

/** Mints the SQLite store at `path`, making it and recording `origin`, without reading git. */
function mintStore(path: string, origin: string): void {
  withSqliteStore(path, 'write', true, () => undefined, {
    readProject: () => ({ rootCommit: STORE_PROJECT, remote: null }),
    newStoreId: () => origin,
  });
}

/** Writes to the existing SQLite store at `path`, minting `origin` when its identity is due one. */
function writeStore(path: string, origin: string): void {
  withSqliteStore(path, 'write', false, () => undefined, {
    readProject: () => ({ rootCommit: STORE_PROJECT, remote: null }),
    newStoreId: () => origin,
  });
}

/**
 * Renames a copy of the store at `path` over it: the host and the path
 * stay as they were and the inode is another one, as a store moved to
 * another filesystem and mounted back arrives.
 */
function renameCopyOver(path: string): void {
  const moved = `${path}.moved`;
  copyFileSync(path, moved);
  renameSync(moved, path);
}

/** The seams of the real store on disk at `root`, over `git`, under `claims.staleAfter: '3d'`. */
function onDiskSeams(git: GitRunner, root: string): StartPreflightClaim {
  return { git, board: null, readStoreId: () => readDeviceStoreId(root, { store: 'sqlite' }), staleAfter: '3d' };
}

/** When every store is minted unless a case says otherwise: before any commit a case makes. */
const MINTED_LONG_BEFORE = '2026-01-01T00:00:00.000Z';

/** The store id answer for `store` and the ids it replaced, or the NDJSON cause when null. */
function storeIdOf(store: string | null, replacedIds: readonly string[] = [], mintedAt = MINTED_LONG_BEFORE): DeviceStoreId {
  return store === null
    ? { ok: false, cause: 'ndjson', reason: 'NDJSON store; Next safe step: rafa effort move --to=sqlite' }
    : { ok: true, storeId: store, replacedIds, mintedAt };
}

/** Runs `act` with every commit it makes dated `date`, by committer. */
function committedOn<T>(date: string, act: () => T): T {
  const before = process.env['GIT_COMMITTER_DATE'];
  process.env['GIT_COMMITTER_DATE'] = date;
  try {
    return act();
  } finally {
    if (before === undefined) delete process.env['GIT_COMMITTER_DATE'];
    else process.env['GIT_COMMITTER_DATE'] = before;
  }
}

/** The seams of device `store`, minted at `mintedAt`, over `git` under `staleAfter`. */
function seamsMintedAt(git: GitRunner, store: string | null, mintedAt: string, staleAfter: ClaimsStaleAfter = '3d'): StartPreflightClaim {
  return { git, board: null, readStoreId: () => storeIdOf(store, [], mintedAt), staleAfter };
}

/** The seams device `store` checks through, over `git`, recording each store read; `replacedIds` are the ids that store replaced. */
function seamsOf(git: GitRunner, store: string | null, reads: string[] = [], replacedIds: readonly string[] = []): StartPreflightClaim {
  return {
    git,
    board: null,
    readStoreId: () => {
      reads.push('read');
      return storeIdOf(store, replacedIds);
    },
    staleAfter: '3d',
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

    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'held', note: '', replacedId: null });
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

describe('a claim the remote holds under an id this store replaced', () => {
  const replaced = [STORE_A_REPLACED];
  const TAKE_BY_A = { action: 'take', issue: ISSUE, store: STORE_A };
  const CLAIM_BY_REPLACED = { action: 'claim', issue: ISSUE, store: STORE_A_REPLACED };

  it('re-signs it with one take commit on the remote tip naming the store\'s own id, moving no local ref; a store that replaced none is refused and pushes nothing', () => {
    const trio = plantTrio('re-sign');
    const sha = pushClaim(trio.a, STORE_A_REPLACED);
    must(trio.a, ['update-ref', `refs/heads/${BRANCH}`, sha]);

    const control = refusal(readRunClaim(PLAN, seamsOf(trio.a, STORE_A)));
    const remoteAfterControl = remoteTip(trio);
    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], replaced));
    const resigned = remoteTip(trio);
    const again = readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], replaced));

    expect(control).toEqual({
      owner: STORE_A_REPLACED,
      reason: `#7 is claimed by store ${STORE_A_REPLACED} on ${BRANCH}, not by this device (store ${STORE_A})`,
    });
    expect(remoteAfterControl).toBe(sha);
    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 're-signed', note: '', replacedId: STORE_A_REPLACED });
    expect(resigned).not.toBe(sha);
    expect(parentOf(trio, resigned)).toBe(sha);
    expect(remoteRecord(trio)).toEqual(TAKE_BY_A);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(sha);
    expect(again).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'held', note: '', replacedId: null });
    expect(remoteTip(trio)).toBe(resigned);
  });

  it('owns it unconfirmed while the remote cannot be reached, making no commit and trying no push; the reachable control re-signs it', () => {
    const trio = plantTrio('re-sign-offline');
    const sha = pushClaim(trio.a, STORE_A_REPLACED);
    const calls: (readonly string[])[] = [];
    const recording: GitRunner = (args) => {
      calls.push(args);
      return trio.a(args);
    };
    goOffline(trio.a);

    const claim = owned(readRunClaim(PLAN, seamsOf(recording, STORE_A, [], replaced)));
    const remoteWhileOffline = remoteTip(trio);
    goOnline(trio, trio.a);
    const control = owned(readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], replaced)));

    expect([claim.via, claim.storeId, claim.replacedId]).toEqual(['unconfirmed', STORE_A, STORE_A_REPLACED]);
    expect(claim.note).toContain('does not appear to be a git repository');
    expect(calls.filter((call) => call[0] === 'push' || call[0] === 'commit-tree')).toEqual([]);
    expect(remoteWhileOffline).toBe(sha);
    expect(control.via).toBe('re-signed');
    expect(remoteRecord(trio)).toEqual(TAKE_BY_A);
  });

  it('owns it with the refusal as its note when git refuses the push, leaving the remote as it was; the same remote without the hook re-signs it', () => {
    const trio = plantTrio('re-sign-refused');
    const control = plantTrio('re-sign-refused-control');
    const sha = pushClaim(trio.a, STORE_A_REPLACED);
    pushClaim(control.a, STORE_A_REPLACED);
    refusePushes(trio);

    const claim = owned(readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], replaced)));
    const controlClaim = owned(readRunClaim(PLAN, seamsOf(control.a, STORE_A, [], replaced)));

    expect([claim.via, claim.storeId, claim.replacedId]).toEqual(['not-re-signed', STORE_A, STORE_A_REPLACED]);
    expect(claim.note).toStartWith(`could not push ${BRANCH} to origin: `);
    expect(claim.note).toContain('refused by the planted hook');
    expect(claim.note).toContain('[remote rejected] (pre-receive hook declined)');
    expect(remoteTip(trio)).toBe(sha);
    expect(remoteRecord(trio)).toEqual(CLAIM_BY_REPLACED);
    expect(controlClaim.via).toBe('re-signed');
    expect(remoteRecord(control)).toEqual(TAKE_BY_A);
  });

  it('owns it with a note when the take commit cannot be made, trying no push', () => {
    const trio = plantTrio('re-sign-no-commit');
    const sha = pushClaim(trio.a, STORE_A_REPLACED);
    const pushes: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      if (args[0] === 'commit-tree') return { ok: false, stdout: '', stderr: 'fatal: unable to write commit object' };
      if (args[0] === 'push') pushes.push(args);
      return trio.a(args);
    };

    const claim = readRunClaim(PLAN, seamsOf(git, STORE_A, [], replaced));

    expect(claim).toEqual({
      outcome: 'owned',
      issue: ISSUE,
      branch: BRANCH,
      storeId: STORE_A,
      via: 'not-re-signed',
      note: `could not make the take commit on ${sha}: fatal: unable to write commit object`,
      replacedId: STORE_A_REPLACED,
    });
    expect(pushes).toEqual([]);
    expect(remoteTip(trio)).toBe(sha);
  });

  it('reads the branch again when the lease is refused by a tip that gained work, and re-signs on the new tip, dropping no commit', () => {
    const trio = plantTrio('re-sign-moved-work');
    pushClaim(trio.a, STORE_A_REPLACED);
    const work: string[] = [];
    const race = racing(trio, 1, () => {
      work.push(pushWorkFromB(trio));
    });

    const claim = owned(readRunClaim(PLAN, seamsOf(race.git, STORE_A, [], replaced)));

    expect([claim.via, claim.replacedId, claim.note]).toEqual(['re-signed', STORE_A_REPLACED, '']);
    expect(work).toHaveLength(1);
    expect(parentOf(trio, remoteTip(trio))).toBe(work[0] ?? '');
    expect(remoteRecord(trio)).toEqual(TAKE_BY_A);
    expect(race.calls.filter(isLeasedPush)).toHaveLength(2);
  });

  it('refuses on the second reading when another store took the claim meanwhile, naming it and leaving its commit the tip', () => {
    const trio = plantTrio('re-sign-moved-taken');
    pushClaim(trio.a, STORE_A_REPLACED);
    const theirs: string[] = [];
    const race = racing(trio, 1, () => {
      theirs.push(pushFromB(trio, (tip) => ownershipOn(trio.b, tip, 'take', STORE_B)));
    });

    const claim = refusal(readRunClaim(PLAN, seamsOf(race.git, STORE_A, [], replaced)));

    expect(claim).toEqual({
      owner: STORE_B,
      reason: `#7 is claimed by store ${STORE_B} on ${BRANCH}, not by this device (store ${STORE_A})`,
    });
    expect(remoteTip(trio)).toBe(theirs[0] ?? '');
    expect(race.calls.filter(isLeasedPush)).toHaveLength(1);
  });

  it('reads the branch again once only: a lease refused a second time is owned with a note, after two pushes and no third', () => {
    const trio = plantTrio('re-sign-moved-twice');
    pushClaim(trio.a, STORE_A_REPLACED);
    const work: string[] = [];
    const race = racing(trio, 2, () => {
      work.push(pushWorkFromB(trio));
    });

    const claim = readRunClaim(PLAN, seamsOf(race.git, STORE_A, [], replaced));

    expect(claim).toEqual({
      outcome: 'owned',
      issue: ISSUE,
      branch: BRANCH,
      storeId: STORE_A,
      via: 'not-re-signed',
      note: `${BRANCH} moved on origin a second time while its take commit was being pushed`,
      replacedId: STORE_A_REPLACED,
    });
    expect(work).toHaveLength(2);
    expect(remoteTip(trio)).toBe(work[1] ?? '');
    expect(remoteRecord(trio)).toEqual(CLAIM_BY_REPLACED);
    expect(race.calls.filter(isLeasedPush)).toHaveLength(2);
  });
});

describe('a claim re-signed over a real store on disk, given a new inode at its own host and path', () => {
  it('reads the claim held before a renamed copy mints a new id, then re-signs it to the id that mint takes', () => {
    const trio = plantTrio('real-mint-resign');
    const path = sqliteStorePath(trio.aRoot);
    const ORIGINAL = 'store-on-disk-original';
    const RESIGNED = 'store-on-disk-resigned';
    mintStore(path, ORIGINAL);
    const sha = pushClaim(trio.a, ORIGINAL);

    renameCopyOver(path);
    const beforeMint = readRunClaim(PLAN, onDiskSeams(trio.a, trio.aRoot));
    const remoteBeforeMint = remoteTip(trio);

    writeStore(path, RESIGNED);
    const afterMint = owned(readRunClaim(PLAN, onDiskSeams(trio.a, trio.aRoot)));

    expect(beforeMint).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: ORIGINAL, via: 'held', note: '', replacedId: null });
    expect(remoteBeforeMint).toBe(sha);
    expect([afterMint.via, afterMint.storeId, afterMint.replacedId]).toEqual(['re-signed', RESIGNED, ORIGINAL]);
    expect(remoteRecord(trio)).toEqual({ action: 'take', issue: ISSUE, store: RESIGNED });
    expect(parentOf(trio, remoteTip(trio))).toBe(sha);
  });

  it('empties store_replaced on the copy\'s first write, so the claim check refuses it on the original\'s claim', () => {
    const trio = plantTrio('real-copy-another-path');
    const originalPath = sqliteStorePath(trio.aRoot);
    const ORIGINAL = 'store-on-disk-original-elsewhere';
    const COPY = 'store-on-disk-copy-elsewhere';
    mintStore(originalPath, ORIGINAL);
    const sha = pushClaim(trio.a, ORIGINAL);

    const copyRoot = realpathSync(mkdtempSync(join(scope, 'real-copy-another-path-copy-')));
    const copyPath = sqliteStorePath(copyRoot);
    mkdirSync(dirname(copyPath), { recursive: true });
    copyFileSync(originalPath, copyPath);

    withSqliteStore(copyPath, 'write', false, () => undefined, {
      readProject: () => ({ rootCommit: STORE_PROJECT, remote: null }),
      newStoreId: () => COPY,
      now: () => new Date(MINTED_LONG_BEFORE),
    });
    const copyId = readDeviceStoreId(copyRoot, { store: 'sqlite' });
    const claim = refusal(readRunClaim(PLAN, onDiskSeams(trio.a, copyRoot)));

    if (!copyId.ok) throw new Error(`expected the copy to mint an id, read ${copyId.cause}`);
    expect(copyId.storeId).toBe(COPY);
    expect(copyId.replacedIds).toEqual([]);
    expect(claim).toEqual({
      owner: ORIGINAL,
      reason: `#7 is claimed by store ${ORIGINAL} on ${BRANCH}, not by this device (store ${COPY})`,
    });
    expect(remoteTip(trio)).toBe(sha);
  });
});

describe('a claim another store holds, read by a store whose id was minted after it', () => {
  const CLAIMED_AT = '2026-10-01T08:00:00.000Z';
  const WORKED_AT = '2026-10-02T09:30:00.000Z';
  const HELD_BY_A = `#7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device (store ${STORE_B})`;
  const MINTED_AFTER = '2026-10-05T08:00:00.000Z';
  const SENTENCE = `This store's id was minted on ${MINTED_AFTER}, after that claim was made (${CLAIMED_AT}), so the claim may be this device's own.`;

  /** Store `a`'s claim dated {@link CLAIMED_AT} on the remote, under work dated {@link WORKED_AT}. */
  function plantClaimUnderWork(name: string): Trio {
    const trio = plantTrio(name);
    committedOn(CLAIMED_AT, () => pushClaim(trio.a, STORE_A));
    committedOn(WORKED_AT, () => pushWorkFromB(trio));
    return trio;
  }

  it('adds the sentence, the date the claim goes stale counted from the tip, and the take line', () => {
    const trio = plantClaimUnderWork('minted-after');

    const claim = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER)));
    const inHours = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER, '36h')));

    expect(claim).toEqual({
      owner: STORE_A,
      reason: [
        HELD_BY_A,
        SENTENCE,
        'It is stale from 2026-10-05T09:30:00.000Z under claims.staleAfter (3d), and from then this takes it:',
        '  rafa claim take 7 --stale',
      ].join('\n'),
    });
    expect(inHours.reason.split('\n')[2]).toBe('It is stale from 2026-10-03T21:30:00.000Z under claims.staleAfter (36h), and from then this takes it:');
  });

  it('adds it for a store minted one millisecond after the claim, and nothing for one minted in its very second or before it', () => {
    const trio = plantClaimUnderWork('minted-before');
    const reasonAt = (mintedAt: string): string => refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, mintedAt))).reason;

    const justAfter = reasonAt('2026-10-01T08:00:00.001Z');
    const sameSecond = reasonAt(CLAIMED_AT);
    const before = reasonAt('2026-09-30T08:00:00.000Z');
    const noDate = reasonAt('not a date');

    expect(justAfter.split('\n')).toHaveLength(4);
    expect(justAfter).toContain('minted on 2026-10-01T08:00:00.001Z, after that claim was made');
    expect([sameSecond, before, noDate]).toEqual([HELD_BY_A, HELD_BY_A, HELD_BY_A]);
  });

  it('says that no claim goes stale under claims.staleAfter: disabled, naming no command; the same store under 3d names one', () => {
    const trio = plantClaimUnderWork('minted-disabled');

    const disabled = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER, 'disabled'))).reason;
    const control = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER))).reason;

    expect(disabled).toBe([
      HELD_BY_A,
      SENTENCE,
      'claims.staleAfter is disabled, so no claim goes stale and rafa claim take would refuse this one.',
    ].join('\n'));
    expect(disabled).not.toContain('--stale');
    expect(control).toContain('\n  rafa claim take 7 --stale');
  });

  it('dates the claim by the latest ownership commit: a take dated after the mint silences it', () => {
    const trio = plantClaimUnderWork('minted-then-taken');
    const before = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER))).reason;
    committedOn('2026-10-06T08:00:00.000Z', () => pushFromB(trio, (tip) => ownershipOn(trio.b, tip, 'take', STORE_A)));

    const after = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER))).reason;

    expect(before).toContain(SENTENCE);
    expect(after).toBe(HELD_BY_A);
  });

  it('adds nothing for a store that names no id, or for a claim that is this store\'s own', () => {
    const trio = plantClaimUnderWork('minted-not-refused');

    const noId = refusal(readRunClaim(PLAN, seamsMintedAt(trio.b, null, MINTED_AFTER))).reason;
    const own = readRunClaim(PLAN, seamsMintedAt(trio.b, STORE_A, MINTED_AFTER));

    expect(noId).not.toContain('minted on');
    expect(own.outcome).toBe('owned');
  });

  it('prints the lines indented under the opening, the command one step further', async () => {
    const trio = plantClaimUnderWork('minted-printed');

    const run = await captured(() => {
      try {
        refuseUnownedClaim(PLAN, seamsMintedAt(trio.b, STORE_B, MINTED_AFTER));
        return null;
      } catch (error) {
        if (!(error instanceof CommandExit)) throw error;
        return error;
      }
    });

    expect(run.value?.message).toBe([
      '❌ Refusing to start: this device does not own the claim on #7.',
      `   ${HELD_BY_A}`,
      `   ${SENTENCE}`,
      '   It is stale from 2026-10-05T09:30:00.000Z under claims.staleAfter (3d), and from then this takes it:',
      '     rafa claim take 7 --stale',
      '   Nothing was checked and nothing was dispatched.',
    ].join('\n'));
  });
});

describe('a claim waiting unpushed on the local branch', () => {
  it('pushes it without moving the local branch, and owns it', () => {
    const trio = plantTrio('retry');
    const sha = leaveClaim(trio.a, STORE_A);
    expect(remoteTip(trio)).toBeNull();

    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'pushed', note: '', replacedId: null });
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
    goOnline(trio, trio.a);
    const control = readRunClaim(PLAN, seamsOf(trio.a, STORE_A));

    expect(owner).toBeNull();
    expect(reason).toStartWith(`the claim on #7 waits unpushed on the local ${BRANCH} and could not be pushed: could not fetch`);
    expect(reason).toEndWith('\nRun rafa loop start again once origin is reachable');
    expect(calls.filter((call) => call[0] === 'push')).toEqual([]);
    expect(tipAt(trio.a, `refs/heads/${BRANCH}`)).toBe(sha);
    expect(control.outcome).toBe('owned');
    expect(remoteTip(trio)).toBe(sha);
  });

  it('pushes a waiting claim that names an id this store replaced as it was made, and the next check re-signs it; a store that replaced none is refused and pushes nothing', () => {
    const trio = plantTrio('retry-replaced');
    const sha = leaveClaim(trio.a, STORE_A_REPLACED);

    const control = refusal(readRunClaim(PLAN, seamsOf(trio.a, STORE_A)));
    const remoteAfterControl = remoteTip(trio);
    const claim = readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], [STORE_A_REPLACED]));
    const remoteAfterRetry = remoteTip(trio);
    const next = owned(readRunClaim(PLAN, seamsOf(trio.a, STORE_A, [], [STORE_A_REPLACED])));

    expect(control.owner).toBe(STORE_A_REPLACED);
    expect(control.reason).toBe(`#7 is claimed by store ${STORE_A_REPLACED} on the local ${BRANCH}, not by this device (store ${STORE_A})`);
    expect(remoteAfterControl).toBeNull();
    expect(claim).toEqual({ outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'pushed', note: '', replacedId: null });
    expect(remoteAfterRetry).toBe(sha);
    expect([next.via, next.replacedId]).toEqual(['re-signed', STORE_A_REPLACED]);
    expect(remoteRecord(trio)).toEqual({ action: 'take', issue: ISSUE, store: STORE_A });
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

  it('prints one info line naming both ids for a re-signed claim; one that cannot be re-signed and one unconfirmed are each one warning naming both', async () => {
    const trio = plantTrio('re-sign-lines');
    pushClaim(trio.a, STORE_A_REPLACED);
    const seams = seamsOf(trio.a, STORE_A, [], [STORE_A_REPLACED]);
    const noCommit: GitRunner = (args) => (args[0] === 'commit-tree'
      ? { ok: false, stdout: '', stderr: 'fatal: unable to write commit object' }
      : trio.a(args));
    const tip = remoteTip(trio);

    const failed = await captured(() => refuseUnownedClaim(PLAN, { ...seams, git: noCommit }));
    goOffline(trio.a);
    const offline = await captured(() => refuseUnownedClaim(PLAN, seams));
    goOnline(trio, trio.a);
    const resigned = await captured(() => refuseUnownedClaim(PLAN, seams));

    const holder = `this device (store ${STORE_A}) under store ${STORE_A_REPLACED}, an id that store replaced`;
    expect([failed.info, failed.warn]).toEqual([[], [
      `⚠️  Could not re-sign the claim on #7: could not make the take commit on ${String(tip)}: fatal: unable to write commit object;`
      + ` ${BRANCH} was read as held by ${holder}, so the run goes on.`,
    ]]);
    expect(offline.info).toEqual([]);
    expect(offline.warn).toHaveLength(1);
    expect(offline.warn[0]).toStartWith('⚠️  Could not confirm the claim on #7: could not fetch');
    expect(offline.warn[0]).toEndWith(`the last fetch left ${BRANCH} held by ${holder}, so the run goes on.`);
    expect([resigned.info, resigned.warn]).toEqual([[
      `🔒 Re-signed the claim on #7 on origin/${BRANCH} from store ${STORE_A_REPLACED}, an id this device's store replaced, to store ${STORE_A}.`,
    ], []]);
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
      staleAfter: '3d',
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

    const none = createStartPreflightClaim(root, { prProvider: 'none', store: 'ndjson', claimsStaleAfter: '36h', ...NO_PROJECT });
    const gh = createStartPreflightClaim(root, { prProvider: 'gh', store: 'ndjson', claimsStaleAfter: 'disabled', ...NO_PROJECT });
    const storeId = none.readStoreId();

    expect(none.board).toBeNull();
    expect(gh.board).not.toBeNull();
    expect(storeId).toMatchObject({ ok: false, cause: 'ndjson' });
    expect([none.staleAfter, gh.staleAfter]).toEqual(['36h', 'disabled']);
    expect(none.git(['rev-parse', '--is-inside-work-tree']).ok).toBe(false);
  });
});

describe('markInDevelopment', () => {
  const held: RunClaim = { outcome: 'owned', issue: ISSUE, branch: BRANCH, storeId: STORE_A, via: 'held', note: '', replacedId: null };

  it('swaps the labels in one write on a first dispatch of an owned claim', async () => {
    const world = boardWorld();

    const run = await captured(() => markInDevelopment(held, world.board, true));

    expect(world.calls).toEqual([
      ['issue', 'edit', '7', '--remove-label', CLAIMED_LABEL, '--add-label', IN_DEVELOPMENT_LABEL],
    ]);
    expect([run.info, run.warn]).toEqual([[], []]);
  });

  it('writes nothing on a resume, or for a run with no claim; the first-dispatch control writes', async () => {
    const world = boardWorld();

    await captured(() => markInDevelopment(held, world.board, false));
    await captured(() => markInDevelopment({ outcome: 'none' }, world.board, true));
    const writtenBefore = world.calls.length;
    await captured(() => markInDevelopment(held, world.board, true));

    expect(writtenBefore).toBe(0);
    expect(world.calls).toHaveLength(1);
  });

  it('warns when the board is not gh or refuses the write, and never throws', async () => {
    const failing = boardWorld(true);

    const noBoard = await captured(() => markInDevelopment(held, null, true));
    const refused = await captured(() => markInDevelopment(held, failing.board, true));

    expect(noBoard.warn).toEqual([
      `⚠️  claim labels: #7 was not moved from ${CLAIMED_LABEL} to ${IN_DEVELOPMENT_LABEL}: the board is not gh; the claim stands in git`,
    ]);
    expect(refused.warn).toHaveLength(1);
    expect(refused.warn[0]).toContain('label write refused');
    expect(failing.calls).toHaveLength(1);
  });
});
