/**
 * Tests for `rafa claim take <n> [--stale]` (`take.ts`), dispatched
 * in-process over a real bare remote and two clones of it, `a` and `b`,
 * standing for two devices: `a` the owner whose claim goes stale, `b`
 * the device that takes it over. The command's seams hand it a clone's
 * `git`, a `gh` board over a recording runner, a label reader answering
 * what a case plants, a store id, and a clock.
 *
 * Staleness is read from the tip's committer date, which git sets from
 * the wall clock, so a case makes a claim stale by moving the seam's
 * clock past `claims.staleAfter` (`3d` by default) rather than by
 * back-dating commits. Every refusal asserts the remote's tip unmoved,
 * beside the cases that move it, so a command that refused everything,
 * or took everything, fails one side; the fresh-claim refusal and the
 * stale-claim take differ only in the clock, which is the control that
 * the clock is what decides.
 */
import type { ClaimTakeSeams } from './take.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { DeviceStoreId } from '../../claims/device.js';
import type { RafaCommand } from '../../cli/command.js';
import type { GitRunner } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhIssueBoard } from '../../board/issue-board.js';
import { makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from '../../claims/git.js';
import { parseClaimMessage } from '../../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../../claims/stale.js';
import { createGitRunner } from '../../pr/index.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createClaimTakeCommand, renderTake, takeOf } from './take.js';

const ISSUE = 7;
const BRANCH = 'feat/rafa-7-take';
const STORE_A = 'store-a';
const STORE_B = 'store-b';
const SUBJECTS = [{ name: 'claim', summary: 'claims' }];
const DAY_MS = 86_400_000;

/** A clock four days on: past the default `claims.staleAfter` of `3d`. */
const STALE_CLOCK = (): Date => new Date(Date.now() + 4 * DAY_MS);

/** The wall clock: a claim pushed moments ago is fresh by it. */
const FRESH_CLOCK = (): Date => new Date();

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-take-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A bare remote, two clones of it, and a rafa project to dispatch from. */
interface World {
  readonly origin: GitRunner;
  readonly a: GitRunner;
  readonly b: GitRunner;
  readonly project: PlantedProject;
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

/** Plants a bare remote whose `main` holds one commit, two clones of it, and a project configured by `config`. */
function plantWorld(name: string, config: string = projectConfigText()): World {
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
    project: plantProject(realpathSync(mkdtempSync(join(root, 'project-'))), config),
  };
}

/** What the remote's `branch` points at, or null when it has none. */
function remoteTip(world: World, branch: string = BRANCH): string | null {
  const result = world.origin(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** Pushes `store`'s claim on `branch` from `git`, answering the claim commit. */
function claimBranch(git: GitRunner, store: string, branch: string = BRANCH): string {
  const made = makeOwnershipCommit(git, 'main', { action: 'claim', issue: ISSUE, store });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(git, made.sha, branch);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return made.sha;
}

/** Pushes one more ownership commit on the remote tip of `branch` from `git`. */
function pushRecord(world: World, git: GitRunner, record: Parameters<typeof makeOwnershipCommit>[2], branch: string = BRANCH): string {
  must(git, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const tip = remoteTip(world, branch);
  if (tip === null) throw new Error(`no ${branch} on the remote`);
  const made = makeOwnershipCommit(git, tip, record);
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, branch, tip);
  if (pushed.outcome !== 'pushed') throw new Error(`record push: ${pushed.outcome}`);
  return made.sha;
}

/** A `gh` board whose runner records every argv. */
function recordingBoard(): { readonly board: ReturnType<typeof createGhIssueBoard>; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return { ok: true, stdout: '', stderr: '' };
  };
  return { board: createGhIssueBoard({ gh }), calls };
}

/** A store id reader answering `storeId`. */
function storeIdOf(storeId: string): () => DeviceStoreId {
  return () => ({ ok: true, storeId });
}

/** A label reader answering `labels` for any issue. */
function labelsOf(labels: readonly string[]): (issue: number) => Promise<readonly string[]> {
  return async () => labels;
}

/** The seams of device `b`, store B: the issue at `labels`, the clock `now`, over a recording board. */
function seamsOfB(world: World, overrides: Partial<ClaimTakeSeams> = {}): ClaimTakeSeams {
  return {
    git: world.b,
    board: recordingBoard().board,
    readStoreId: storeIdOf(STORE_B),
    labels: labelsOf([CLAIMED_LABEL]),
    now: STALE_CLOCK,
    ...overrides,
  };
}

/** The command over `seams`, whatever project it runs in. */
function commandOver(seams: ClaimTakeSeams): RafaCommand {
  return createClaimTakeCommand(() => seams);
}

/** Dispatches `rafa claim take <words>` from the world's project over `seams`. */
async function take(world: World, words: readonly string[], seams: ClaimTakeSeams): Promise<CapturedRun> {
  return dispatchInProject(['claim', 'take', ...words], SUBJECTS, [commandOver(seams)], world.project);
}

/** The latest ownership record on the remote's branch. */
function tipRecord(world: World, branch: string = BRANCH): ReturnType<typeof parseClaimMessage> {
  return parseClaimMessage(must(world.origin, ['log', '-1', '--format=%B', `refs/heads/${branch}`]));
}

/** The take record store B pushes. */
const TAKE_BY_B = { kind: 'ownership', record: { action: 'take', issue: ISSUE, store: STORE_B } };

/** Asserts `run` refused with `text` and the remote at `tip`. */
function expectRefused(run: CapturedRun, text: string, world: World, tip: string | null): void {
  expect(run.exitCode).toBe(1);
  expect(`${run.stdout}${run.stderr}`).toContain(`rafa claim take: ${text}`);
  expect(remoteTip(world)).toBe(tip);
}

describe('takeOf', () => {
  const weights = {
    issue: ISSUE,
    storeId: STORE_B,
    labels: [CLAIMED_LABEL],
    labelWarning: null,
    staleAfter: '3d',
    now: new Date('2026-09-30T00:00:00Z'),
    stale: false,
  } as const;

  it('passes over an absent branch and refuses an unreadable one, naming it', () => {
    expect(takeOf({ state: 'absent', branch: BRANCH }, weights)).toEqual({ state: 'passed' });
    expect(takeOf({ state: 'unreadable', branch: BRANCH, reason: 'bad object' }, weights))
      .toEqual({ state: 'refused', reason: `the claim on ${BRANCH} could not be read, so #7 stays taken: bad object` });
  });

  it('reads a tip dated after the clock as idle for no time, so never stale', () => {
    const reading = {
      state: 'found',
      branch: BRANCH,
      tip: 'a'.repeat(40),
      tipCommittedAt: new Date('2026-10-30T00:00:00Z'),
      commits: [],
      ownership: { state: 'held', owner: STORE_A, pending: null, ignored: [] },
    } as const;

    const answer = takeOf(reading, { ...weights, stale: true });

    expect(answer.state).toBe('refused');
    expect(answer.state === 'refused' && answer.reason).toContain('idle 0h: not stale until it has stood claims.staleAfter (3d)');
  });
});

describe('rafa claim take, over a stale claim', () => {
  it('pushes a take commit naming this store on a stale rafa:claimed claim, which then owns it', async () => {
    const world = plantWorld('take');
    const claimed = claimBranch(world.a, STORE_A);
    const { board, calls } = recordingBoard();

    const run = await take(world, ['7'], seamsOfB(world, { board }));

    expect(run.exitCode).toBe(0);
    const tip = remoteTip(world);
    expect(tip).not.toBe(claimed);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(claimed);
    expect(tipRecord(world)).toEqual(TAKE_BY_B);
    expect(run.stdout).toContain(`Took over the claim on #7 on ${BRANCH} (store ${STORE_A}'s, idle 4d):`);
    expect(run.stdout).toContain(`this device (store ${STORE_B}) now owns the claim.`);
    expect(calls).toEqual([]);
  });

  it('answers the branch, the stores and the commit as the json result', async () => {
    const world = plantWorld('json');
    claimBranch(world.a, STORE_A);

    const run = await take(world, ['7', '--output=json'], seamsOfB(world));

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result?.data).toMatchObject({
      issue: ISSUE,
      branch: BRANCH,
      storeId: STORE_B,
      from: STORE_A,
      was: 'stale-claimed',
      sha: remoteTip(world),
      labelWarning: null,
    });
  });

  it('takes a stale rafa:in-development claim with --stale', async () => {
    const world = plantWorld('stale-flag');
    claimBranch(world.a, STORE_A);

    const run = await take(world, ['7', '--stale'], seamsOfB(world, { labels: labelsOf([IN_DEVELOPMENT_LABEL]) }));

    expect(run.exitCode).toBe(0);
    expect(tipRecord(world)).toEqual(TAKE_BY_B);
    expect(run.stdout).toContain('idle 4d and in development)');
  });

  it('takes a released claim at any age, reading no labels', async () => {
    const world = plantWorld('released');
    claimBranch(world.a, STORE_A);
    pushRecord(world, world.a, { action: 'release', issue: ISSUE, store: STORE_A });
    let labelReads = 0;
    const labels = async (): Promise<readonly string[]> => {
      labelReads += 1;
      return [];
    };

    const run = await take(world, ['7'], seamsOfB(world, { labels, now: FRESH_CLOCK }));

    expect(run.exitCode).toBe(0);
    expect(tipRecord(world)).toEqual(TAKE_BY_B);
    expect(run.stdout).toContain(`(released by store ${STORE_A})`);
    expect(labelReads).toBe(0);
  });

  it('keeps the work commits on the branch and moves no local branch', async () => {
    const world = plantWorld('work');
    const claimed = claimBranch(world.a, STORE_A);
    must(world.a, ['checkout', '--quiet', '-b', BRANCH, claimed]);
    must(world.a, ['commit', '--quiet', '--allow-empty', '-m', 'work']);
    must(world.a, ['push', '--quiet', 'origin', BRANCH]);
    const work = remoteTip(world);
    const bHead = must(world.b, ['rev-parse', 'HEAD']);

    const run = await take(world, ['7'], seamsOfB(world));

    expect(run.exitCode).toBe(0);
    expect(must(world.origin, ['rev-parse', `${remoteTip(world) ?? ''}^`])).toBe(work);
    expect(must(world.b, ['rev-parse', 'HEAD'])).toBe(bHead);
    expect(world.b(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).ok).toBe(false);
  });
});

describe('rafa claim take refuses', () => {
  it('a claim that has not gone stale, naming how long it has stood', async () => {
    const world = plantWorld('fresh');
    const claimed = claimBranch(world.a, STORE_A);

    const run = await take(world, ['7', '--stale'], seamsOfB(world, { now: FRESH_CLOCK }));

    expectRefused(run, 'the claim on #7 cannot be taken over, so nothing was taken', world, claimed);
    expect(run.stderr).toContain(`#7 is claimed by store ${STORE_A} on ${BRANCH}, idle 0h: not stale until it has stood claims.staleAfter (3d)`);
  });

  it('any claim when claims.staleAfter is disabled, whatever the clock or --stale', async () => {
    const world = plantWorld('disabled', `${projectConfigText()}claims:\n  staleAfter: disabled\n`);
    const claimed = claimBranch(world.a, STORE_A);

    const run = await take(world, ['7', '--stale'], seamsOfB(world, { now: () => new Date(Date.now() + 400 * DAY_MS) }));

    expectRefused(run, 'the claim on #7 cannot be taken over', world, claimed);
    expect(run.stderr).toContain('claims.staleAfter is disabled, so no claim goes stale');
  });

  it('a stale rafa:in-development claim without --stale, naming the flag', async () => {
    const world = plantWorld('in-development');
    const claimed = claimBranch(world.a, STORE_A);

    const run = await take(world, ['7'], seamsOfB(world, { labels: labelsOf([IN_DEVELOPMENT_LABEL]) }));

    expectRefused(run, 'the claim on #7 cannot be taken over', world, claimed);
    expect(run.stderr).toContain('idle 4d and stale, but in development, which is never taken over without --stale;'
      + ' run rafa claim take 7 --stale to take it');
  });

  it('a stale claim whose labels cannot be read, without --stale, naming why', async () => {
    const world = plantWorld('no-labels');
    const claimed = claimBranch(world.a, STORE_A);
    const failing = async (): Promise<readonly string[]> => {
      throw new Error('gh is down');
    };

    const noBoard = await take(world, ['7'], seamsOfB(world, { board: null, labels: null }));
    const failed = await take(world, ['7'], seamsOfB(world, { labels: failing }));

    expectRefused(noBoard, 'the claim on #7 cannot be taken over', world, claimed);
    expect(noBoard.stderr).toContain('(the board is not gh, so the stage labels of #7 could not be read, so it reads as in development)');
    expectRefused(failed, 'the claim on #7 cannot be taken over', world, claimed);
    expect(failed.stderr).toContain('(the stage labels of #7 could not be read: gh is down, so it reads as in development)');
  });

  it('a claim this device already holds', async () => {
    const world = plantWorld('own');
    const claimed = claimBranch(world.a, STORE_B);

    const run = await take(world, ['7'], seamsOfB(world));

    expectRefused(run, 'the claim on #7 cannot be taken over', world, claimed);
    expect(run.stderr).toContain(`this device (store ${STORE_B}) already holds the claim on #7 on ${BRANCH}; there is nothing to take`);
  });

  it('a released branch while another branch of the issue holds a fresh claim', async () => {
    const world = plantWorld('two-branches');
    const other = 'feat/rafa-7-other';
    claimBranch(world.a, STORE_A, other);
    pushRecord(world, world.a, { action: 'release', issue: ISSUE, store: STORE_A }, other);
    const released = remoteTip(world, other);
    const claimed = claimBranch(world.a, STORE_A);

    const run = await take(world, ['7'], seamsOfB(world, { now: FRESH_CLOCK }));

    expectRefused(run, 'the claim on #7 cannot be taken over', world, claimed);
    expect(remoteTip(world, other)).toBe(released);
  });

  it('a branch carrying no claim commit', async () => {
    const world = plantWorld('no-claim');
    must(world.a, ['push', '--quiet', 'origin', `main:refs/heads/${BRANCH}`]);
    const tip = remoteTip(world);

    const run = await take(world, ['7'], seamsOfB(world));

    expectRefused(run, 'the claim on #7 cannot be taken over', world, tip);
    expect(run.stderr).toContain(`${BRANCH} exists on origin carrying no claim commit, so #7 stays taken`);
  });

  it('when the remote holds no branch of the issue', async () => {
    const world = plantWorld('no-branch');

    const run = await take(world, ['7'], seamsOfB(world));

    expectRefused(run, 'origin has no feat/rafa-7-<slug> branch, so #7 carries no claim', world, null);
  });

  it('when this device has no store id, before any git call', async () => {
    const world = plantWorld('no-id');
    const claimed = claimBranch(world.a, STORE_A);
    const gitCalls: string[][] = [];
    const git: GitRunner = (args) => {
      gitCalls.push([...args]);
      return world.b(args);
    };
    const readStoreId = (): DeviceStoreId => ({ ok: false, cause: 'ndjson', reason: 'the store is NDJSON; move it' });

    const run = await take(world, ['7'], seamsOfB(world, { git, readStoreId }));

    expectRefused(run, 'the store is NDJSON; move it', world, claimed);
    expect(gitCalls).toEqual([]);
  });

  it('when origin cannot be reached', async () => {
    const world = plantWorld('offline');
    const claimed = claimBranch(world.a, STORE_A);
    must(world.b, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const run = await take(world, ['7'], seamsOfB(world));

    expectRefused(run, 'could not fetch the feat/rafa-* branches from origin', world, claimed);
  });

  it('when the owner pushes between the fetch and the push: the lease refuses the take', async () => {
    const world = plantWorld('race');
    claimBranch(world.a, STORE_A);
    let raced: string | null = null;
    const git: GitRunner = (args) => {
      if (args[0] === 'push' && raced === null) {
        raced = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: 'store-c' });
      }
      return world.b(args);
    };

    const run = await take(world, ['7'], seamsOfB(world, { git }));

    expect(raced).not.toBeNull();
    expectRefused(run, `${BRANCH} moved on origin while the claim on #7 was being taken over; nothing was taken`, world, raced);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'hand', issue: ISSUE, store: STORE_A, to: 'store-c' } });
  });

  it('a line that is not one issue number with a valueless --stale, before reading the store or git', async () => {
    const world = plantWorld('bad-line');
    const claimed = claimBranch(world.a, STORE_A);
    let storeReads = 0;
    const readStoreId = (): DeviceStoreId => {
      storeReads += 1;
      return { ok: true, storeId: STORE_B };
    };
    const lines: readonly (readonly [readonly string[], string])[] = [
      [['seven'], '"seven" is no issue number'],
      [[], 'Usage: rafa claim take <n> [--stale]'],
      [['7', '8'], 'Usage: rafa claim take <n> [--stale]'],
      [['--stale', '7'], '--stale takes no value, and read "7" as one'],
    ];

    for (const [words, text] of lines) {
      const run = await take(world, words, seamsOfB(world, { readStoreId }));

      expect(run.exitCode).toBe(1);
      expect(`${run.stdout}${run.stderr}`).toContain(text);
      expect(remoteTip(world)).toBe(claimed);
    }
    expect(storeReads).toBe(0);
  });
});

describe('renderTake', () => {
  it('names the stage of a stale claim and the store of a released one', () => {
    const base = { issue: ISSUE, branch: BRANCH, storeId: STORE_B, from: STORE_A, sha: 'f'.repeat(40), labelWarning: null };

    expect(renderTake({ ...base, was: 'stale-claimed', idleMs: 36 * 3_600_000 })).toContain(`(store ${STORE_A}'s, idle 36h)`);
    expect(renderTake({ ...base, was: 'released', idleMs: null })).toContain(`(released by store ${STORE_A})`);
  });
});
