/**
 * Tests for the claims section of `rafa status` (`claims.ts`), over a
 * real bare repository and two clones of it, `a` and `b`, standing for
 * two devices, and through `readStatusSections` for its wiring.
 *
 * Every reading of a claim sits beside a control that could have read
 * otherwise: a branch passed over for carrying no claim commit is first
 * shown to be listed by git; a claim read stale sits beside the same
 * claim read an hour old; the labels read as `rafa:claimed` sit beside
 * the same claim with labels unread; and the owner read before a fetch
 * sits beside the new owner read after one.
 */
import type { ClaimBranches, ClaimLabels } from './claims.js';
import type { StatusConfig, StatusSeams } from './sections.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { ClaimRecord } from '../claims/record.js';
import type { NextBoard } from '../next/readings.js';
import type { GitRunner } from '../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { fetchClaimBranches, makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from '../claims/git.js';
import { createGitRunner } from '../pr/index.js';

import { readClaimBranches, readClaims } from './claims.js';
import { readStatusSections } from './sections.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-claims-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A bare remote and two clones of it, each with a runner and its directory. */
interface Trio {
  readonly a: GitRunner;
  readonly b: GitRunner;
  readonly aDir: string;
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
  const aDir = join(root, 'a');
  return { a: cloneInto(originPath, aDir, 'device-a'), b: cloneInto(originPath, join(root, 'b'), 'device-b'), aDir };
}

/** `git` pushes a new claim branch holding `record`'s commit on `main`. */
function claim(git: GitRunner, branch: string, record: ClaimRecord): void {
  const made = makeOwnershipCommit(git, 'main', record);
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(git, made.sha, branch);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
}

/** `git` fetches, then pushes `record`'s commit on `branch`'s remote tip, leased on it. */
function move(git: GitRunner, branch: string, record: ClaimRecord): void {
  if (!fetchClaimBranches(git).ok) throw new Error('could not fetch');
  const lease = must(git, ['rev-parse', `refs/remotes/origin/${branch}`]);
  const made = makeOwnershipCommit(git, lease, record);
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, branch, lease);
  if (pushed.outcome !== 'pushed') throw new Error(`ownership push: ${pushed.outcome}`);
}

/** `git` pushes a branch of `main` carrying no claim commit at all. */
function plainBranch(git: GitRunner, branch: string): void {
  must(git, ['push', '--quiet', 'origin', `main:refs/heads/${branch}`]);
}

/** A board issue numbered `number` carrying `labels`. */
function issue(number: number, labels: readonly string[]): BoardIssue {
  return { number, title: `issue ${String(number)}`, body: '', state: 'OPEN', stateReason: null, labels, type: 'feature', module: '' };
}

/** The listing read, holding `issues`. */
function listed(...issues: readonly BoardIssue[]): ClaimLabels {
  return { read: true, issues };
}

/** The tip date of the one branch `branches` found. */
function tipOf(branches: ClaimBranches): Date {
  const [only] = branches.found;
  if (only === undefined) throw new Error('the fixture found no claim branch');
  return only.tipCommittedAt;
}

describe('readClaimBranches', () => {
  it('reads each claim branch on origin, in name order, passing over one git lists with no claim commit', () => {
    const trio = plantTrio('list');
    claim(trio.b, 'feat/rafa-8-second', { action: 'claim', issue: 8, store: 'store-b' });
    claim(trio.b, 'feat/rafa-7-first', { action: 'claim', issue: 7, store: 'store-b' });
    plainBranch(trio.b, 'feat/rafa-9-plain');
    must(trio.a, ['fetch', '--quiet', 'origin']);

    const branches = readClaimBranches(trio.a);

    expect(must(trio.a, ['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin/feat/'])).toContain('feat/rafa-9-plain');
    expect(branches.found.map((found) => [found.branch, found.ownership.state])).toEqual([
      ['feat/rafa-7-first', 'held'],
      ['feat/rafa-8-second', 'held'],
    ]);
    expect(branches.notes).toEqual([]);
  });

  it('reads origin as last fetched: the old owner before a fetch, the store that took it over after one', () => {
    const trio = plantTrio('fetched');
    claim(trio.a, 'feat/rafa-7-taken', { action: 'claim', issue: 7, store: 'store-a' });
    move(trio.b, 'feat/rafa-7-taken', { action: 'take', issue: 7, store: 'store-b' });

    const before = readClaimBranches(trio.a);
    must(trio.a, ['fetch', '--quiet', 'origin']);
    const after = readClaimBranches(trio.a);

    const owner = (branches: ClaimBranches): string | null => {
      const ownership = branches.found[0]?.ownership;
      return ownership?.state === 'held'
        ? ownership.owner
        : null;
    };
    expect(owner(before)).toBe('store-a');
    expect(owner(after)).toBe('store-b');
  });

  it('answers no branch in a clone of a remote with no claim branch', () => {
    const trio = plantTrio('empty');

    expect(readClaimBranches(trio.a)).toEqual({ found: [], notes: [] });
  });

  it('throws what git said when the origin branches cannot be listed', () => {
    const refusing: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });

    expect(() => readClaimBranches(refusing)).toThrow('the origin branches could not be listed: fatal: not a git repository');
  });
});

describe('readClaims', () => {
  it('reads a rafa:claimed claim idle past claims.staleAfter as stale-claimed, where an hour old it is held', () => {
    const trio = plantTrio('stale');
    claim(trio.a, 'feat/rafa-7-stale', { action: 'claim', issue: 7, store: 'store-a' });
    const branches = readClaimBranches(trio.a);
    const tip = tipOf(branches);
    const labels = listed(issue(7, ['type:feature', 'rafa:claimed']));

    const old = readClaims({ branches, labels, staleAfter: '3d', now: new Date(tip.getTime() + 4 * DAY_MS) });
    const fresh = readClaims({ branches, labels, staleAfter: '3d', now: new Date(tip.getTime() + HOUR_MS) });

    expect(old).toEqual({
      claims: [{
        branch: 'feat/rafa-7-stale',
        issue: 7,
        owner: 'store-a',
        handingTo: null,
        releasedBy: null,
        stage: ['rafa:claimed'],
        state: 'stale-claimed',
        tipCommittedAt: tip.toISOString(),
        idleMs: 4 * DAY_MS,
      }],
      notes: [],
    });
    expect(fresh.claims.map((row) => [row.state, row.idleMs])).toEqual([['held', HOUR_MS]]);
  });

  it('reads the same stale claim as in development, with a note, when the labels were not read', () => {
    const trio = plantTrio('unread');
    claim(trio.a, 'feat/rafa-7-unread', { action: 'claim', issue: 7, store: 'store-a' });
    const branches = readClaimBranches(trio.a);
    const now = new Date(tipOf(branches).getTime() + 4 * DAY_MS);

    const unread = readClaims({ branches, labels: { read: false, problem: 'gh timed out' }, staleAfter: '3d', now });
    const missing = readClaims({ branches, labels: listed(issue(8, ['rafa:claimed'])), staleAfter: '3d', now });

    expect(unread.claims.map((row) => [row.stage, row.state])).toEqual([[null, 'stale-in-development']]);
    expect(unread.notes).toEqual(['the stage labels were not read: gh timed out']);
    expect(missing.claims.map((row) => [row.stage, row.state])).toEqual([[null, 'stale-in-development']]);
    expect(missing.notes).toEqual(['#7 is not in the board listing, so its stage labels were not read']);
  });

  it('names a released claim\'s releaser and no owner, and a pending handover\'s receiver', () => {
    const trio = plantTrio('moves');
    claim(trio.a, 'feat/rafa-7-released', { action: 'claim', issue: 7, store: 'store-a' });
    move(trio.a, 'feat/rafa-7-released', { action: 'release', issue: 7, store: 'store-a' });
    claim(trio.a, 'feat/rafa-8-handed', { action: 'claim', issue: 8, store: 'store-a' });
    move(trio.a, 'feat/rafa-8-handed', { action: 'hand', issue: 8, store: 'store-a', to: 'store-b' });
    const branches = readClaimBranches(trio.a);

    const read = readClaims({ branches, labels: listed(issue(7, []), issue(8, ['rafa:in-development'])), staleAfter: 'disabled', now: new Date() });

    expect(read.claims.map((row) => [row.issue, row.owner, row.releasedBy, row.handingTo, row.stage, row.state])).toEqual([
      [7, null, 'store-a', null, [], 'released'],
      [8, 'store-a', null, 'store-b', ['rafa:in-development'], 'held'],
    ]);
    expect(read.notes).toEqual([]);
  });

  it('asks for no label note when there is no claim, whatever the labels', () => {
    const read = readClaims({ branches: { found: [], notes: [] }, labels: { read: false, problem: 'gh timed out' }, staleAfter: '3d', now: new Date() });

    expect(read).toEqual({ claims: [], notes: [] });
  });
});

describe('the claims section of readStatusSections', () => {
  /** The settings the wiring cases read with. */
  const CONFIG: StatusConfig = {
    planDir: '.plans',
    prBase: 'main',
    prProvider: null,
    roadmapIssue: 31,
    claimsStaleAfter: '3d',
    cleanupKeep: [],
    cleanupStaleDays: 30,
    cleanupWorktreeIdleDays: 7,
  };

  /** A board with no line left, so the board section asks for nothing more. */
  const BOARD: NextBoard = {
    next: () => Promise.resolve({ roadmap: 31, line: null, passed: 0, problems: [] }),
    isReady: () => Promise.resolve(false),
    blocking: () => Promise.resolve(null),
  };

  /** Seams over the real clone: `origin` as `remote`, the listing holding `issues`, the clock at `now`. */
  function seamsFor(remote: string | null, issues: readonly BoardIssue[], now: Date): StatusSeams {
    return {
      readRemote: () => remote,
      openGh: () => () => Promise.resolve({ ok: true, stdout: '[]', stderr: '' }),
      board: () => BOARD,
      listing: () => () => Promise.resolve(issues),
      blockedIssues: () => Promise.resolve({ readings: [], faults: [], problem: null, unchecked: null }),
      now: () => now,
      timeoutMs: 2_000,
    };
  }

  it('reads the owner and the stage label from the board listing under a gh provider, and none under another', async () => {
    const trio = plantTrio('wired');
    claim(trio.b, 'feat/rafa-7-wired', { action: 'claim', issue: 7, store: 'store-b' });
    must(trio.a, ['fetch', '--quiet', 'origin']);
    const now = new Date(tipOf(readClaimBranches(trio.a)).getTime() + 4 * DAY_MS);
    const input = { root: trio.aDir, home: scope, config: CONFIG };
    const listing = [issue(7, ['rafa:claimed'])];

    const gh = await readStatusSections(input, seamsFor('https://github.com/open-tomato/rafa.git', listing, now));
    const none = await readStatusSections(input, seamsFor(null, listing, now));

    expect(gh.claims.read && gh.claims.claims.map((row) => [row.owner, row.stage, row.state])).toEqual([['store-b', ['rafa:claimed'], 'stale-claimed']]);
    expect(gh.claims.read && gh.claims.notes).toEqual([]);
    expect(none.claims.read && none.claims.claims.map((row) => [row.owner, row.stage, row.state])).toEqual([['store-b', null, 'stale-in-development']]);
    expect(none.claims.read && none.claims.notes).toEqual([
      'the stage labels were not read: pr.provider is none, as origin is no GitHub remote, and rafa status reads the stage labels through gh alone',
    ]);
  });

  it('is not read when git cannot list the origin branches, and the loops section is read all the same', async () => {
    const dir = realpathSync(mkdtempSync(join(scope, 'no-repo-')));

    const read = await readStatusSections({ root: dir, home: scope, config: CONFIG }, seamsFor(null, [], new Date()));

    expect(read.claims.read).toBe(false);
    expect(!read.claims.read && read.claims.problem).toStartWith('the origin branches could not be listed: fatal: not a git repository');
    expect(read.loops.read).toBe(true);
  });
});
