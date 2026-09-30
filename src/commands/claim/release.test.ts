/**
 * Tests for `rafa claim release <n>` (`release.ts`), dispatched in-process
 * over a real bare remote and two clones of it, `a` and `b`, standing for
 * two devices. The command's seams hand it a clone's `git`, a `gh` board
 * over a recording runner, and a store id; nothing reaches GitHub.
 *
 * What the remote holds is read from the bare repository itself, never
 * through the clone that pushed. Every refusal asserts the remote's tip
 * unmoved and no label write sent, beside the release case that moves
 * both, so a command that refused everything, or pushed everything,
 * fails one side.
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
import { makeOwnershipCommit, pushNewClaimBranch, pushOwnershipCommit } from '../../claims/git.js';
import { parseClaimMessage } from '../../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../../claims/stale.js';
import { createGitRunner } from '../../pr/index.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createClaimReleaseCommand, readIssueArgument } from './release.js';

const ISSUE = 7;
const BRANCH = 'feat/rafa-7-release';
const STORE_A = 'store-a';
const STORE_B = 'store-b';
const SUBJECTS = [{ name: 'claim', summary: 'claims' }];

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-release-')));

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

/** Pushes `store`'s claim on `branch` from `git`, answering the remote tip. */
function claimBranch(world: World, git: GitRunner, store: string, branch: string = BRANCH): string {
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

/** A `gh` board whose runner records every argv and fails when `fails` says so. */
function recordingBoard(fails = false): { readonly board: ReturnType<typeof createGhIssueBoard>; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return fails
      ? { ok: false, stdout: '', stderr: 'label write refused' }
      : { ok: true, stdout: '', stderr: '' };
  };
  return { board: createGhIssueBoard({ gh }), calls };
}

/** The command over `seams`, whatever project it runs in. */
function commandOver(seams: ClaimCommandSeams): RafaCommand {
  return createClaimReleaseCommand(() => seams);
}

/** A store id reader answering `storeId`. */
function storeIdOf(storeId: string): () => DeviceStoreId {
  return () => ({ ok: true, storeId });
}

/** Dispatches `rafa claim release <words>` from the world's project over `seams`. */
async function release(world: World, words: readonly string[], seams: ClaimCommandSeams): Promise<CapturedRun> {
  return dispatchInProject(['claim', 'release', ...words], SUBJECTS, [commandOver(seams)], world.project);
}

/** The latest ownership record on the remote's `branch`. */
function tipRecord(world: World, branch: string = BRANCH): ReturnType<typeof parseClaimMessage> {
  return parseClaimMessage(must(world.origin, ['log', '-1', '--format=%B', `refs/heads/${branch}`]));
}

describe('readIssueArgument', () => {
  it('reads one positive whole number', () => {
    expect(readIssueArgument(['324'], 'usage')).toBe(324);
  });

  it('refuses a word that is no issue number, with exit code 1 and the usage', () => {
    for (const word of ['0', '07', '-3', 'x', '1.5', '#7', '99999999999999999999']) {
      expect(() => readIssueArgument([word], 'rafa claim release <n>')).toThrow(`"${word}" is no issue number`);
    }
  });

  it('refuses no argument and two', () => {
    expect(() => readIssueArgument([], 'u')).toThrow('Expected one argument, got none');
    expect(() => readIssueArgument(['1', '2'], 'u')).toThrow('Expected one argument, got 2: 1 2');
  });
});

describe('rafa claim release, by the owner', () => {
  it('pushes a release commit on the remote tip and takes both stage labels off', async () => {
    const world = plantWorld('owner');
    const claim = claimBranch(world, world.a, STORE_A);
    const { board, calls } = recordingBoard();

    const run = await release(world, [String(ISSUE)], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expect(run.exitCode).toBe(0);
    const tip = remoteTip(world);
    expect(tip).not.toBe(claim);
    expect(must(world.origin, ['rev-parse', `${tip ?? ''}^`])).toBe(claim);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'release', issue: ISSUE, store: STORE_A } });
    expect(calls).toEqual([
      ['issue', 'edit', '7', '--remove-label', IN_DEVELOPMENT_LABEL],
      ['issue', 'edit', '7', '--remove-label', CLAIMED_LABEL],
    ]);
    expect(run.stdout).toContain(`Released the claim on #7 (store ${STORE_A}) on ${BRANCH}: release commit ${tip ?? ''} pushed to origin.`);
  });

  it('answers the branch, store and release commit as the json result', async () => {
    const world = plantWorld('json');
    claimBranch(world, world.a, STORE_A);
    const { board } = recordingBoard();

    const run = await release(world, ['7', '--output=json'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expect(run.exitCode).toBe(0);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    expect(result).toMatchObject({
      data: { issue: ISSUE, branch: BRANCH, storeId: STORE_A, sha: remoteTip(world), labelWarning: null },
    });
  });

  it('ends a pending handover: the release is the latest ownership commit', async () => {
    const world = plantWorld('pending');
    claimBranch(world, world.a, STORE_A);
    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });

    const run = await release(world, ['7'], { git: world.a, board: recordingBoard().board, readStoreId: storeIdOf(STORE_A) });

    expect(run.exitCode).toBe(0);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'release', issue: ISSUE, store: STORE_A } });
  });

  it('stands, with a warning, when the board is not gh or the label write fails', async () => {
    for (const board of [null, recordingBoard(true).board]) {
      const world = plantWorld('label-warning');
      const claim = claimBranch(world, world.a, STORE_A);

      const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

      expect(run.exitCode).toBe(0);
      expect(remoteTip(world)).not.toBe(claim);
      expect(tipRecord(world)).toMatchObject({ kind: 'ownership', record: { action: 'release' } });
      expect(`${run.stdout}${run.stderr}`).toContain('claim labels: #7 was not unlabelled');
      expect(`${run.stdout}${run.stderr}`).toContain('the claim stands in git');
    }
  });

  it('moves no local ref of the releasing clone but its remote-tracking one', async () => {
    const world = plantWorld('local');
    const claim = claimBranch(world, world.a, STORE_A);
    must(world.a, ['update-ref', `refs/heads/${BRANCH}`, claim]);

    const run = await release(world, ['7'], { git: world.a, board: null, readStoreId: storeIdOf(STORE_A) });

    expect(run.exitCode).toBe(0);
    expect(must(world.a, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(claim);
    expect(must(world.a, ['rev-parse', `refs/remotes/origin/${BRANCH}`])).toBe(remoteTip(world) ?? '');
  });
});

describe('rafa claim release, refused', () => {
  /** Asserts `run` refused with `text`, the remote at `tip`, and no label write. */
  function expectRefused(run: CapturedRun, text: string, world: World, tip: string | null, calls: readonly (readonly string[])[]): void {
    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(text);
    expect(remoteTip(world)).toBe(tip);
    expect(calls).toEqual([]);
  }

  it('when another store holds the claim, naming the owner', async () => {
    const world = plantWorld('other-owner');
    const claim = claimBranch(world, world.a, STORE_A);
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.b, board, readStoreId: storeIdOf(STORE_B) });

    expectRefused(run, `#7 is claimed by store ${STORE_A} on ${BRANCH}, not by this device (store ${STORE_B})`, world, claim, calls);
  });

  it('when the claim was already released', async () => {
    const world = plantWorld('released');
    claimBranch(world, world.a, STORE_A);
    const released = pushRecord(world, world.a, { action: 'release', issue: ISSUE, store: STORE_A });
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, `the claim on ${BRANCH} was already released by store ${STORE_A}`, world, released, calls);
  });

  it('when the handover was accepted: the receiver owns it now', async () => {
    const world = plantWorld('accepted');
    claimBranch(world, world.a, STORE_A);
    pushRecord(world, world.a, { action: 'hand', issue: ISSUE, store: STORE_A, to: STORE_B });
    const accepted = pushRecord(world, world.b, { action: 'accept', issue: ISSUE, store: STORE_B });
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, `#7 is claimed by store ${STORE_B}`, world, accepted, calls);
  });

  it('when the remote holds no branch of the issue', async () => {
    const world = plantWorld('absent');
    claimBranch(world, world.a, STORE_A, 'feat/rafa-8-other');
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, 'origin has no feat/rafa-7-<slug> branch, so #7 carries no claim', world, null, calls);
  });

  it('when the branch carries no claim commit', async () => {
    const world = plantWorld('no-claim');
    must(world.a, ['push', '--quiet', 'origin', `main:refs/heads/${BRANCH}`]);
    const main = must(world.a, ['rev-parse', 'main']);
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, `${BRANCH} carries no claim commit`, world, main, calls);
  });

  it('when this store holds the issue on two branches, naming both', async () => {
    const world = plantWorld('two');
    const first = claimBranch(world, world.a, STORE_A);
    claimBranch(world, world.a, STORE_A, 'feat/rafa-7-second');
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, `holds #7 on more than one branch: ${BRANCH}, feat/rafa-7-second`, world, first, calls);
  });

  it('when this device has no store id, before any git call', async () => {
    const world = plantWorld('no-id');
    const claim = claimBranch(world, world.a, STORE_A);
    const gitCalls: string[][] = [];
    const git: GitRunner = (args) => {
      gitCalls.push([...args]);
      return world.a(args);
    };
    const { board, calls } = recordingBoard();
    const readStoreId = (): DeviceStoreId => ({ ok: false, cause: 'ndjson', reason: 'the store is NDJSON; move it' });

    const run = await release(world, ['7'], { git, board, readStoreId });

    expectRefused(run, 'the store is NDJSON; move it', world, claim, calls);
    expect(gitCalls).toEqual([]);
  });

  it('when the store cannot be read', async () => {
    const world = plantWorld('store-throws');
    const claim = claimBranch(world, world.a, STORE_A);
    const { board, calls } = recordingBoard();
    const readStoreId = (): DeviceStoreId => {
      throw new Error('database disk image is malformed');
    };

    const run = await release(world, ['7'], { git: world.a, board, readStoreId });

    expectRefused(run, 'could not be read for this device\'s store id: database disk image is malformed', world, claim, calls);
  });

  it('when origin cannot be reached', async () => {
    const world = plantWorld('offline');
    const claim = claimBranch(world, world.a, STORE_A);
    must(world.a, ['remote', 'set-url', 'origin', join(scope, 'nowhere.git')]);
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, 'could not fetch the feat/rafa-* branches from origin', world, claim, calls);
  });

  it('when the branch moves between the fetch and the push: the lease refuses it', async () => {
    const world = plantWorld('race');
    claimBranch(world, world.a, STORE_A);
    let raced: string | null = null;
    const git: GitRunner = (args) => {
      if (args[0] === 'push' && raced === null) raced = pushRecord(world, world.b, { action: 'take', issue: ISSUE, store: STORE_B });
      return world.a(args);
    };
    const { board, calls } = recordingBoard();

    const run = await release(world, ['7'], { git, board, readStoreId: storeIdOf(STORE_A) });

    expect(raced).not.toBeNull();
    expectRefused(run, `${BRANCH} moved on origin while the claim on #7 was being released; nothing was released`, world, raced, calls);
    expect(tipRecord(world)).toEqual({ kind: 'ownership', record: { action: 'take', issue: ISSUE, store: STORE_B } });
  });

  it('when the argument is no issue number, before reading anything', async () => {
    const world = plantWorld('bad-arg');
    const claim = claimBranch(world, world.a, STORE_A);
    const { board, calls } = recordingBoard();

    const run = await release(world, ['seven'], { git: world.a, board, readStoreId: storeIdOf(STORE_A) });

    expectRefused(run, '"seven" is no issue number', world, claim, calls);
  });
});
