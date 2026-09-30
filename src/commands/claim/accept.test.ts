/**
 * Tests for `rafa claim accept <n>` (`accept.ts`), dispatched in-process
 * over a real bare remote and two clones of it, `a` and `b`, standing
 * for two devices: `a` the owner that hands over, `b` the receiver that
 * accepts. The command's seams hand it a clone's `git`, a `gh` board
 * over a recording runner, and a store id; nothing reaches GitHub.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed. Every refusal asserts the remote's tip
 * unmoved, beside the cases that move it, so a command that refused
 * everything, or pushed everything, fails one side. The board records
 * every call so the "no label changes" claim is a reading.
 */
import type { ClaimCommandSeams } from './release.js';
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
import { makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit, readClaimBranch } from '../../claims/git.js';
import { parseClaimMessage } from '../../claims/record.js';
import { createGitRunner } from '../../pr/index.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createClaimAcceptCommand, offerOf } from './accept.js';

const ISSUE = 7;
const BRANCH = 'feat/rafa-7-accept';
const STORE_A = 'store-a';
const STORE_B = 'store-b';
const STORE_C = 'store-c';
const SUBJECTS = [{ name: 'claim', summary: 'claims' }];

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-accept-')));

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

/** Plants a bare remote whose `main` holds one commit, two clones of it, and a project. */
function plantWorld(name: string): World {
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
    project: plantProject(realpathSync(mkdtempSync(join(root, 'project-')))),
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
function pushRecord(world: World, git: GitRunner, record: Parameters<typeof makeOwnershipCommit>[2]): string {
  must(git, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  const tip = remoteTip(world);
  if (tip === null) throw new Error(`no ${BRANCH} on the remote`);
  const made = makeOwnershipCommit(git, tip, record);
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, BRANCH, tip);
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

/** The command over `seams`, whatever project it runs in. */
function commandOver(seams: ClaimCommandSeams): RafaCommand {
  return createClaimAcceptCommand(() => seams);
}

/** Dispatches `rafa claim accept <words>` from the world's project over `seams`. */
async function accept(world: World, words: readonly string[], seams: ClaimCommandSeams): Promise<CapturedRun> {
  return dispatchInProject(['claim', 'accept', ...words], SUBJECTS, [commandOver(seams)], world.project);
}

/** The seams of device `b`, store B, over a recording board. */
function seamsOfB(world: World, board = recordingBoard().board): ClaimCommandSeams {
  return { git: world.b, board, readStoreId: storeIdOf(STORE_B) };
}

/** The latest ownership record on the remote's branch. */
function tipRecord(world: World): ReturnType<typeof parseClaimMessage> {
  return parseClaimMessage(must(world.origin, ['log', '-1', '--format=%B', `refs/heads/${BRANCH}`]));
}

/** Who holds the branch's claim, as a fresh fetch into clone `a` reads it. */
function ownershipSeenByA(world: World): unknown {
  must(world.a, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  const reading = readClaimBranch(world.a, BRANCH);
  return reading.state === 'found'
    ? reading.ownership
    : reading.state;
}

/** Store A's claim on the branch with a handover to `to` pushed on it; answers the handover commit. */
function handedTo(world: World, to: string): string {
  claimBranch(world.a, STORE_A);
  return pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to });
}

/** Asserts `run` refused with `text` and the remote at `tip`. */
function expectRefused(run: CapturedRun, text: string, world: World, tip: string | null): void {
  expect(run.exitCode).toBe(1);
  expect(`${run.stdout}${run.stderr}`).toContain(`rafa claim accept: ${text}`);
  expect(remoteTip(world)).toBe(tip);
}

describe('offerOf', () => {
  it('reads a branch that is absent or unreadable as no offer, naming it', () => {
    expect(offerOf({ state: 'absent', branch: BRANCH }, ISSUE, STORE_B))
      .toEqual({ state: 'refused', reason: `${BRANCH} is gone from origin` });
    expect(offerOf({ state: 'unreadable', branch: BRANCH, reason: 'bad object' }, ISSUE, STORE_B))
      .toEqual({ state: 'refused', reason: `the claim on ${BRANCH} could not be read: bad object` });
  });
});

describe('rafa claim accept, by the receiver', () => {
  it('pushes an accept commit naming this store on the remote tip, which then owns the claim', async () => {
    const world = plantWorld('accept');
    const handed = handedTo(world, STORE_B);
    const { board, calls } = recordingBoard();

    const run = await accept(world, ['7'], seamsOfB(world, board));

    expect(run.exitCode).toBe(0);
    const tip = remoteTip(world);
    expect(tip).not.toBe(handed);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(handed);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'accept', issue: ISSUE, store: STORE_B } });
    expect(ownershipSeenByA(world)).toEqual({ state: 'held', owner: STORE_B, pending: null, ignored: [] });
    expect(calls).toEqual([]);
    expect(run.stdout).toContain(`Accepted the handover of #7 on ${BRANCH} from store ${STORE_A}:`
      + ` accept commit ${tip ?? ''} pushed to origin; this device (store ${STORE_B}) now owns the claim.`);
  });

  it('answers the branch, stores and commits as the json result', async () => {
    const world = plantWorld('json');
    const handed = handedTo(world, STORE_B);

    const run = await accept(world, ['7', '--output=json'], seamsOfB(world));

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result).toMatchObject({
      data: { issue: ISSUE, branch: BRANCH, storeId: STORE_B, from: STORE_A, handSha: handed, sha: remoteTip(world) },
    });
  });

  it('accepts a handover that replaced an earlier one to another store', async () => {
    const world = plantWorld('replacing');
    handedTo(world, STORE_C);
    const handed = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });

    const run = await accept(world, ['7'], seamsOfB(world));

    expect(run.exitCode).toBe(0);
    expect(must(world.origin, ['rev-parse', `${remoteTip(world) ?? ''}^`])).toBe(handed);
    expect(tipRecord(world)).toMatchObject({ kind: 'ownership', record: { action: 'accept', store: STORE_B } });
  });

  it('keeps the work commits on the branch and moves no local ref but the remote-tracking one', async () => {
    const world = plantWorld('work');
    const claim = claimBranch(world.a, STORE_A);
    const work = must(world.a, ['commit-tree', `${claim}^{tree}`, '-p', claim, '-m', 'feat: some work']);
    must(world.a, ['push', '--quiet', 'origin', `${work}:refs/heads/${BRANCH}`]);
    const handed = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });
    const head = must(world.b, ['rev-parse', 'HEAD']);

    const run = await accept(world, ['7'], seamsOfB(world));

    expect(run.exitCode).toBe(0);
    expect(must(world.origin, ['rev-list', `refs/heads/${BRANCH}`])).toContain(work);
    expect(must(world.origin, ['rev-parse', `${remoteTip(world) ?? ''}^`])).toBe(handed);
    expect(must(world.b, ['rev-parse', 'HEAD'])).toBe(head);
    expect(world.b(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).ok).toBe(false);
    expect(must(world.b, ['rev-parse', `refs/remotes/origin/${BRANCH}`])).toBe(remoteTip(world) ?? '');
  });
});

describe('rafa claim accept, refused', () => {
  it('when the handover was withdrawn, naming the owner and the withdraw commit', async () => {
    const world = plantWorld('withdrawn');
    handedTo(world, STORE_B);
    const withdrawn = pushRecord(world, world.a, { action: 'withdraw', issue: ISSUE, store: STORE_A });

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, `no handover of #7 to this device (store ${STORE_B}) is pending, so nothing was accepted`, world, withdrawn);
    expect(run.stderr).toContain(`the handover to this device on ${BRANCH} was withdrawn by store ${STORE_A} (commit ${withdrawn})`);
  });

  it('when the handover was withdrawn and a later one names another store, reading the first end', async () => {
    const world = plantWorld('withdrawn-then-other');
    handedTo(world, STORE_B);
    const withdrawn = pushRecord(world, world.a, { action: 'withdraw', issue: ISSUE, store: STORE_A });
    const other = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_C });

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'no handover of #7 to this device', world, other);
    expect(run.stderr).toContain(`was withdrawn by store ${STORE_A} (commit ${withdrawn})`);
  });

  it('when the handover to this store was replaced by one to another store', async () => {
    const world = plantWorld('replaced');
    handedTo(world, STORE_B);
    const other = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_C });

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'no handover of #7 to this device', world, other);
    expect(run.stderr).toContain(`the handover to this device on ${BRANCH} was replaced by a handover to store ${STORE_C} (commit ${other})`);
  });

  it('when the owner released the claim over the pending handover', async () => {
    const world = plantWorld('released');
    handedTo(world, STORE_B);
    const released = pushRecord(world, world.a, { action: 'release', issue: ISSUE, store: STORE_A });

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'no handover of #7 to this device', world, released);
    expect(run.stderr).toContain(`was ended by a release commit of store ${STORE_A} (commit ${released})`);
  });

  it('when no handover names this store, the one pending naming another', async () => {
    const world = plantWorld('other-receiver');
    const handed = handedTo(world, STORE_C);

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'no handover of #7 to this device', world, handed);
    expect(run.stderr).toContain(`no handover on ${BRANCH} names this device's store ${STORE_B}; store ${STORE_A} holds the claim`);
  });

  it('when the claim carries no handover at all', async () => {
    const world = plantWorld('no-handover');
    const claim = claimBranch(world.a, STORE_A);

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'no handover of #7 to this device', world, claim);
    expect(run.stderr).toContain(`no handover on ${BRANCH} names this device's store ${STORE_B}`);
  });

  it('when this store already accepted: a second accept is refused', async () => {
    const world = plantWorld('twice');
    handedTo(world, STORE_B);
    const first = await accept(world, ['7'], seamsOfB(world));
    expect(first.exitCode).toBe(0);
    const accepted = remoteTip(world);

    const second = await accept(world, ['7'], seamsOfB(world));

    expectRefused(second, 'no handover of #7 to this device', world, accepted);
    expect(second.stderr).toContain(`this device (store ${STORE_B}) already holds the claim on #7 on ${BRANCH}`);
  });

  it('when the branch carries no claim commit, or the claim was released with no handover', async () => {
    const world = plantWorld('unclaimed');
    const root = must(world.a, ['rev-parse', 'main']);
    must(world.a, ['push', '--quiet', 'origin', `${root}:refs/heads/${BRANCH}`]);

    const bare = await accept(world, ['7'], seamsOfB(world));

    expectRefused(bare, 'no handover of #7 to this device', world, root);
    expect(bare.stderr).toContain(`${BRANCH} carries no claim commit`);

    const other = 'feat/rafa-7-other';
    claimBranch(world.a, STORE_A, other);
    must(world.a, ['fetch', '--quiet', 'origin', `+refs/heads/${other}:refs/remotes/origin/${other}`]);
    const made = makeOwnershipCommit(world.a, `refs/remotes/origin/${other}`, { action: 'release', issue: ISSUE, store: STORE_A });
    if (!made.ok) throw new Error(made.reason);
    const lease = must(world.a, ['rev-parse', `refs/remotes/origin/${other}`]);
    expect(pushOwnershipCommit(world.a, made.sha, other, lease)).toEqual({ outcome: 'pushed' });

    const released = await accept(world, ['7'], seamsOfB(world));

    expectRefused(released, 'no handover of #7 to this device', world, root);
    expect(released.stderr).toContain(`the claim on ${other} was released by store ${STORE_A}`);
  });

  it('when the remote holds no branch of the issue', async () => {
    const world = plantWorld('absent');
    claimBranch(world.a, STORE_A, 'feat/rafa-8-other');

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'origin has no feat/rafa-7-<slug> branch, so #7 carries no claim', world, null);
  });

  it('when this device has no store id, before any git call', async () => {
    const world = plantWorld('no-id');
    const handed = handedTo(world, STORE_B);
    const gitCalls: string[][] = [];
    const git: GitRunner = (args) => {
      gitCalls.push([...args]);
      return world.b(args);
    };
    const readStoreId = (): DeviceStoreId => ({ ok: false, cause: 'ndjson', reason: 'the store is NDJSON; move it' });

    const run = await accept(world, ['7'], { git, board: null, readStoreId });

    expectRefused(run, 'the store is NDJSON; move it', world, handed);
    expect(gitCalls).toEqual([]);
  });

  it('when origin cannot be reached', async () => {
    const world = plantWorld('offline');
    const handed = handedTo(world, STORE_B);
    must(world.b, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const run = await accept(world, ['7'], seamsOfB(world));

    expectRefused(run, 'could not fetch the feat/rafa-* branches from origin', world, handed);
  });

  it('when the owner withdraws between the fetch and the push: the lease refuses the accept', async () => {
    const world = plantWorld('race');
    handedTo(world, STORE_B);
    let raced: string | null = null;
    const git: GitRunner = (args) => {
      if (args[0] === 'push' && raced === null) raced = pushRecord(world, world.a, { action: 'withdraw', issue: ISSUE, store: STORE_A });
      return world.b(args);
    };

    const run = await accept(world, ['7'], { git, board: null, readStoreId: storeIdOf(STORE_B) });

    expect(raced).not.toBeNull();
    expectRefused(run, `${BRANCH} moved on origin while the claim on #7 was being accepted; nothing was accepted`, world, raced);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'withdraw', issue: ISSUE, store: STORE_A } });
  });

  it('when the line is not one issue number, before reading the store or git', async () => {
    const world = plantWorld('bad-line');
    const handed = handedTo(world, STORE_B);
    let storeReads = 0;
    const readStoreId = (): DeviceStoreId => {
      storeReads += 1;
      return { ok: true, storeId: STORE_B };
    };
    const seams: ClaimCommandSeams = { git: world.b, board: null, readStoreId };
    const lines: readonly (readonly [readonly string[], string])[] = [
      [['seven'], '"seven" is no issue number'],
      [['07'], '"07" is no issue number'],
      [[], 'Usage: rafa claim accept <n>'],
      [['7', '8'], 'Usage: rafa claim accept <n>'],
    ];

    for (const [words, text] of lines) {
      const run = await accept(world, words, seams);

      expect(run.exitCode).toBe(1);
      expect(`${run.stdout}${run.stderr}`).toContain(text);
      expect(remoteTip(world)).toBe(handed);
    }
    expect(storeReads).toBe(0);
  });
});
