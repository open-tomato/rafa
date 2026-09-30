/**
 * Tests for `rafa claim hand <n> --to=<store id> [--withdraw]`
 * (`hand.ts`), dispatched in-process over a real bare remote and two
 * clones of it, `a` and `b`, standing for two devices. The command's
 * seams hand it a clone's `git`, a `gh` board over a recording runner,
 * and a store id; nothing reaches GitHub.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed. Every refusal asserts the remote's tip
 * unmoved, beside the cases that move it, so a command that refused
 * everything, or pushed everything, fails one side. The board records
 * every call so the "no label changes" claim is a reading, not an
 * assumption.
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

import { createClaimHandCommand, readHandRequest } from './hand.js';

const ISSUE = 7;
const BRANCH = 'feat/rafa-7-hand';
const STORE_A = 'store-a';
const STORE_B = 'store-b';
const STORE_C = 'store-c';
const SUBJECTS = [{ name: 'claim', summary: 'claims' }];

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-hand-')));

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
  return createClaimHandCommand(() => seams);
}

/** Dispatches `rafa claim hand <words>` from the world's project over `seams`. */
async function hand(world: World, words: readonly string[], seams: ClaimCommandSeams): Promise<CapturedRun> {
  return dispatchInProject(['claim', 'hand', ...words], SUBJECTS, [commandOver(seams)], world.project);
}

/** The seams of device `a`, store A, over a recording board. */
function seamsOfA(world: World, board = recordingBoard().board): ClaimCommandSeams {
  return { git: world.a, board, readStoreId: storeIdOf(STORE_A) };
}

/** The latest ownership record on the remote's branch. */
function tipRecord(world: World): ReturnType<typeof parseClaimMessage> {
  return parseClaimMessage(must(world.origin, ['log', '-1', '--format=%B', `refs/heads/${BRANCH}`]));
}

/** Who holds the branch's claim, as a fresh fetch into clone `b` reads it. */
function ownershipSeenByB(world: World): unknown {
  must(world.b, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  const reading = readClaimBranch(world.b, BRANCH);
  return reading.state === 'found'
    ? reading.ownership
    : reading.state;
}

describe('readHandRequest', () => {
  it('reads --to=<store id> as a handover and a bare --withdraw as a withdrawal', () => {
    expect(readHandRequest({ to: STORE_B })).toEqual({ action: 'hand', to: STORE_B });
    expect(readHandRequest({ to: `  ${STORE_B} ` })).toEqual({ action: 'hand', to: STORE_B });
    expect(readHandRequest({ withdraw: true })).toEqual({ action: 'withdraw' });
    expect(readHandRequest({ withdraw: false, to: STORE_B })).toEqual({ action: 'hand', to: STORE_B });
  });

  it('refuses neither, both, a bare --to, an empty or blank-holding one, and a value typed to --withdraw', () => {
    const cases: readonly (readonly [Record<string, string | boolean>, string])[] = [
      [{}, 'name the receiving store with --to=<store id>'],
      [{ withdraw: false }, 'name the receiving store with --to=<store id>'],
      [{ to: STORE_B, withdraw: true }, '--to and --withdraw are two actions; give one'],
      [{ to: true }, '--to needs a store id'],
      [{ to: false }, '--to needs a store id'],
      [{ to: '' }, '--to="" is no store id'],
      [{ to: 'store b' }, '--to="store b" is no store id'],
      [{ withdraw: '7' }, '--withdraw takes no value, and read "7" as one; type the issue number before the flags'],
    ];
    for (const [flags, text] of cases) {
      expect(() => readHandRequest(flags)).toThrow(text);
      expect(() => readHandRequest(flags)).toThrow('Usage: rafa claim hand <n> --to=<store id>');
    }
  });
});

describe('rafa claim hand --to, by the owner', () => {
  it('pushes a hand commit naming the receiver on the remote tip, the owner staying the owner', async () => {
    const world = plantWorld('hand');
    const claim = claimBranch(world.a, STORE_A);
    const { board, calls } = recordingBoard();

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world, board));

    expect(run.exitCode).toBe(0);
    const tip = remoteTip(world);
    expect(tip).not.toBe(claim);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(claim);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B } });
    expect(ownershipSeenByB(world)).toEqual({ state: 'held', owner: STORE_A, pending: { to: STORE_B, sha: tip }, ignored: [] });
    expect(calls).toEqual([]);
    expect(run.stdout).toContain(`Handed the claim on #7 (store ${STORE_A}) on ${BRANCH} over to store ${STORE_B}:`
      + ` hand commit ${tip ?? ''} pushed to origin. This device stays the owner until store ${STORE_B} runs rafa claim accept 7.`);
    expect(run.stdout).not.toContain('It replaces');
  });

  it('reads --to given as a separate word', async () => {
    const world = plantWorld('spaced');
    claimBranch(world.a, STORE_A);

    const run = await hand(world, ['7', '--to', STORE_B], seamsOfA(world));

    expect(run.exitCode).toBe(0);
    expect(tipRecord(world)).toMatchObject({ kind: 'ownership', record: { action: 'hand', to: STORE_B } });
  });

  it('answers the branch, stores and commit as the json result', async () => {
    const world = plantWorld('json');
    claimBranch(world.a, STORE_A);

    const run = await hand(world, ['7', `--to=${STORE_B}`, '--output=json'], seamsOfA(world));

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result).toMatchObject({
      data: { issue: ISSUE, branch: BRANCH, action: 'hand', storeId: STORE_A, to: STORE_B, replaced: null, sha: remoteTip(world) },
    });
  });

  it('replaces a pending handover to another store, naming it', async () => {
    const world = plantWorld('replace');
    claimBranch(world.a, STORE_A);
    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_C });

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expect(run.exitCode).toBe(0);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B } });
    expect(run.stdout).toContain(`It replaces the handover to store ${STORE_C}.`);
  });

  it('holds over work commits after the claim, and moves no local ref but the remote-tracking one', async () => {
    const world = plantWorld('work');
    const claim = claimBranch(world.a, STORE_A);
    must(world.a, ['update-ref', `refs/heads/${BRANCH}`, claim]);
    const work = must(world.a, ['commit-tree', `${claim}^{tree}`, '-p', claim, '-m', 'feat: some work']);
    must(world.a, ['push', '--quiet', 'origin', `${work}:refs/heads/${BRANCH}`]);

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expect(run.exitCode).toBe(0);
    expect(must(world.origin, ['rev-parse', `${remoteTip(world) ?? ''}^`])).toBe(work);
    expect(must(world.a, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(claim);
    expect(must(world.a, ['rev-parse', `refs/remotes/origin/${BRANCH}`])).toBe(remoteTip(world) ?? '');
  });
});

describe('rafa claim hand --withdraw, by the owner', () => {
  it('pushes a withdraw commit that ends the pending handover, the owner keeping the claim', async () => {
    const world = plantWorld('withdraw');
    claimBranch(world.a, STORE_A);
    const handed = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });
    const { board, calls } = recordingBoard();

    const run = await hand(world, ['7', '--withdraw'], seamsOfA(world, board));

    expect(run.exitCode).toBe(0);
    const tip = remoteTip(world);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(handed);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'withdraw', issue: ISSUE, store: STORE_A } });
    expect(ownershipSeenByB(world)).toEqual({ state: 'held', owner: STORE_A, pending: null, ignored: [] });
    expect(calls).toEqual([]);
    expect(run.stdout).toContain(`Withdrew the handover of #7 to store ${STORE_B} on ${BRANCH}:`
      + ` withdraw commit ${tip ?? ''} pushed to origin; store ${STORE_A} keeps the claim.`);
  });

  it('answers the withdrawn receiver as the json result', async () => {
    const world = plantWorld('withdraw-json');
    claimBranch(world.a, STORE_A);
    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });

    const run = await hand(world, ['7', '--withdraw', '--output=json'], seamsOfA(world));

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result).toMatchObject({
      data: { issue: ISSUE, action: 'withdraw', storeId: STORE_A, to: STORE_B, replaced: null, sha: remoteTip(world) },
    });
  });
});

describe('rafa claim hand, refused', () => {
  /** Asserts `run` refused with `text` and the remote at `tip`. */
  function expectRefused(run: CapturedRun, text: string, world: World, tip: string | null): void {
    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(`rafa claim hand: ${text}`);
    expect(remoteTip(world)).toBe(tip);
  }

  it('when another store holds the claim, naming the owner', async () => {
    const world = plantWorld('other-owner');
    const claim = claimBranch(world.a, STORE_A);

    const run = await hand(world, ['7', `--to=${STORE_C}`], { git: world.b, board: null, readStoreId: storeIdOf(STORE_B) });

    expectRefused(run, 'this device does not own the claim on #7, so nothing was pushed', world, claim);
    expect(run.stderr).toContain(`#7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device (store ${STORE_B})`);
  });

  it('when the receiver holds a pending handover but has not accepted it', async () => {
    const world = plantWorld('receiver');
    claimBranch(world.a, STORE_A);
    const handed = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });

    const run = await hand(world, ['7', '--withdraw'], { git: world.b, board: null, readStoreId: storeIdOf(STORE_B) });

    expectRefused(run, 'this device does not own the claim on #7', world, handed);
  });

  it('when the handover was accepted: the old owner can no longer withdraw it', async () => {
    const world = plantWorld('accepted');
    claimBranch(world.a, STORE_A);
    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });
    const accepted = pushRecord(world, world.b, { action: 'accept', issue: ISSUE, store: STORE_B });

    const run = await hand(world, ['7', '--withdraw'], seamsOfA(world));

    expectRefused(run, 'this device does not own the claim on #7', world, accepted);
    expect(run.stderr).toContain(`#7 is claimed by store ${STORE_B}`);
  });

  it('when the claim was released', async () => {
    const world = plantWorld('released');
    claimBranch(world.a, STORE_A);
    const released = pushRecord(world, world.a, { action: 'release', issue: ISSUE, store: STORE_A });

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expectRefused(run, 'this device does not own the claim on #7', world, released);
    expect(run.stderr).toContain(`the claim on ${BRANCH} was already released by store ${STORE_A}`);
  });

  it('when a handover to the same store is already pending, naming its commit', async () => {
    const world = plantWorld('repeat');
    claimBranch(world.a, STORE_A);
    const handed = pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expectRefused(run, `#7 is already handed over to store ${STORE_B} on ${BRANCH} (commit ${handed}); nothing was pushed`, world, handed);
  });

  it('when --withdraw finds no handover pending, including one already withdrawn', async () => {
    const world = plantWorld('nothing-pending');
    const claim = claimBranch(world.a, STORE_A);

    const first = await hand(world, ['7', '--withdraw'], seamsOfA(world));

    expectRefused(first, `no handover of #7 is pending on ${BRANCH}, so there is nothing to withdraw; nothing was pushed`, world, claim);

    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });
    const withdrawn = pushRecord(world, world.a, { action: 'withdraw', issue: ISSUE, store: STORE_A });

    const second = await hand(world, ['7', '--withdraw'], seamsOfA(world));

    expectRefused(second, `no handover of #7 is pending on ${BRANCH}, so there is nothing to withdraw`, world, withdrawn);
  });

  it('when --to names this device\'s own store', async () => {
    const world = plantWorld('self');
    const claim = claimBranch(world.a, STORE_A);

    const run = await hand(world, ['7', `--to=${STORE_A}`], seamsOfA(world));

    expectRefused(run, `--to=${STORE_A} is this device's own store; a handover names another store`, world, claim);
  });

  it('when the remote holds no branch of the issue', async () => {
    const world = plantWorld('absent');
    claimBranch(world.a, STORE_A, 'feat/rafa-8-other');

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expectRefused(run, 'origin has no feat/rafa-7-<slug> branch, so #7 carries no claim', world, null);
  });

  it('when this device has no store id, before any git call', async () => {
    const world = plantWorld('no-id');
    const claim = claimBranch(world.a, STORE_A);
    const gitCalls: string[][] = [];
    const git: GitRunner = (args) => {
      gitCalls.push([...args]);
      return world.a(args);
    };
    const readStoreId = (): DeviceStoreId => ({ ok: false, cause: 'ndjson', reason: 'the store is NDJSON; move it' });

    const run = await hand(world, ['7', `--to=${STORE_B}`], { git, board: null, readStoreId });

    expectRefused(run, 'the store is NDJSON; move it', world, claim);
    expect(gitCalls).toEqual([]);
  });

  it('when origin cannot be reached', async () => {
    const world = plantWorld('offline');
    const claim = claimBranch(world.a, STORE_A);
    must(world.a, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);

    const run = await hand(world, ['7', `--to=${STORE_B}`], seamsOfA(world));

    expectRefused(run, 'could not fetch the feat/rafa-* branches from origin', world, claim);
  });

  it('when the branch moves between the fetch and the push: the lease refuses it', async () => {
    const world = plantWorld('race');
    claimBranch(world.a, STORE_A);
    let raced: string | null = null;
    const git: GitRunner = (args) => {
      if (args[0] === 'push' && raced === null) raced = pushRecord(world, world.b, { action: 'take', issue: ISSUE, store: STORE_B });
      return world.a(args);
    };

    const run = await hand(world, ['7', `--to=${STORE_C}`], { git, board: null, readStoreId: storeIdOf(STORE_A) });

    expect(raced).not.toBeNull();
    expectRefused(run, `${BRANCH} moved on origin while the claim on #7 was being handed over; nothing was pushed`, world, raced);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'take', issue: ISSUE, store: STORE_B } });
  });

  it('when the line is malformed, before reading the store or git', async () => {
    const world = plantWorld('bad-line');
    const claim = claimBranch(world.a, STORE_A);
    let storeReads = 0;
    const readStoreId = (): DeviceStoreId => {
      storeReads += 1;
      return { ok: true, storeId: STORE_A };
    };
    const seams: ClaimCommandSeams = { git: world.a, board: null, readStoreId };
    const lines: readonly (readonly [readonly string[], string])[] = [
      [['seven', `--to=${STORE_B}`], '"seven" is no issue number'],
      [['7'], 'name the receiving store with --to=<store id>'],
      [['--withdraw', '7'], '--withdraw takes no value, and read "7" as one'],
      [['7', `--to=${STORE_B}`, '--withdraw'], '--to and --withdraw are two actions'],
    ];

    for (const [words, text] of lines) {
      const run = await hand(world, words, seams);

      expect(run.exitCode).toBe(1);
      expect(`${run.stdout}${run.stderr}`).toContain(text);
      expect(remoteTip(world)).toBe(claim);
    }
    expect(storeReads).toBe(0);
  });
});
