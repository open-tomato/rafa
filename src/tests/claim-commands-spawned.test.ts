/**
 * `rafa claim release`, `rafa claim hand`, `rafa claim accept` and
 * `rafa claim take`, spawned as the real `rafa` binary
 * (`src/tests/cli-capture.ts`) from separate clones of one bare remote,
 * each its own device: the proof that the ownership commands
 * (`src/commands/claim/*.ts`) hold over REAL git, not only over the
 * fakes their own `*.test.ts` files drive in-process.
 *
 * Five scenarios, each its own bare `origin` and its own devices, `a`
 * and `b`, so nothing one scenario pushes is read by another:
 *
 *   1. `b` runs `claim release` on a claim `a` holds: refused, naming the
 *      owner, and `origin`'s tip stays the claim commit.
 *   2. `a` hands its claim to `b` with `claim hand --to`, and `b`'s own
 *      `claim accept` then moves ownership: two real pushes, each read
 *      back off `origin` itself.
 *   3. `a` hands the claim to `b` and then withdraws it with
 *      `claim hand --withdraw` before `b` ever accepts; `b`'s
 *      `claim accept` is then refused, naming the withdraw commit.
 *   4. `b` runs `claim take` on a claim `a` made moments ago: refused for
 *      being fresh, naming how long `claims.staleAfter` (3d by default)
 *      still has to run.
 *   5. `a`'s claim has stood stale, so `b`'s `claim take --stale` reads it
 *      as takeable and reaches its own push — held there by a stand-in
 *      `git` on `b`'s own PATH ({@link plantPushGate}, the technique
 *      `src/tests/release-settle-race-spawned-cli.test.ts` uses for the
 *      same reason: two real processes cannot be timed to the
 *      millisecond). While `b` is held, `a` pushes a work commit of its
 *      own to the branch, moving `origin`'s tip; `b`'s held push is then
 *      let through and refused by the lease it took before `a`'s push
 *      landed, exactly as `take.ts`'s own module note says a returning
 *      owner is never overwritten.
 *
 * Every device's project config sets `pr.provider: none`, so no `gh` is
 * ever planted and no board write is attempted: what each scenario
 * proves is the git side alone. Every device's effort store is minted
 * with a store id of its own before any command runs, so
 * `readDeviceStoreId` (`src/claims/device.ts`) answers it with no row
 * written first, exactly as `src/tests/plan-claim-race-spawned.test.ts`'s
 * own `mintDeviceStore` does.
 */
import type { ScratchRepo, CapturedRun } from './cli-capture.js';
import type { GitRunner } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { makeOwnershipCommit, pushNewClaimBranch } from '../claims/git.js';
import { formatClaimMessage, parseClaimMessage } from '../claims/record.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/index.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';

/** This suite's own temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-commands-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** How long a spawned run may take before this file gives up waiting on it. */
const SPAWN_TIMEOUT_MS = 30_000;

/** How long a case may wait for the held push in scenario 5 to reach its gate. */
const GATE_TIMEOUT_MS = 15_000;

/** No board is ever reached: every device plants this, so `claim` touches no `gh`. */
const CONFIG = 'pr:\n  provider: none\n';

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
  return result.stdout.trim();
}

/** A fresh directory under this suite's own, one per world this file builds. */
function freshDir(): string {
  worldCount += 1;
  return realpathSync(mkdtempSync(join(tempBase, `world-${String(worldCount)}-`)));
}

/** A bare `origin` under `dir`, holding one commit on `main`. */
function plantOrigin(dir: string): string {
  const originPath = join(dir, 'origin.git');
  must(createGitRunner(dir), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seed = join(dir, 'seed');
  must(createGitRunner(dir), ['clone', '--quiet', originPath, seed]);
  const seedGit = createGitRunner(seed);
  must(seedGit, ['config', 'user.name', 'seed']);
  must(seedGit, ['config', 'user.email', 'seed@example.invalid']);
  must(seedGit, ['config', 'commit.gpgsign', 'false']);
  must(seedGit, ['commit', '--quiet', '--allow-empty', '-m', 'root']);
  must(seedGit, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return originPath;
}

/**
 * Mints the effort store at `repo` under `storeId`: a writing open with
 * no rows, so `readDeviceStoreId` answers it with no row written first.
 * `readProject` is left at its real default, so the mint records the
 * clone's actual git root commit rather than a placeholder.
 */
function mintDeviceStore(repo: string, storeId: string): void {
  withSqliteStore(sqliteStorePath(repo), 'write', true, () => undefined, {
    newStoreId: () => storeId,
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  });
}

/** One device: a clone of `originPath` under `dir`, its own store id, bin, home and call log. */
function plantDevice(originPath: string, dir: string, label: string, storeId: string): ScratchRepo {
  const root = realpathSync(mkdtempSync(join(dir, `${label}-`)));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  must(createGitRunner(root), ['clone', '--quiet', originPath, repo]);
  const git = createGitRunner(repo);
  must(git, ['config', 'user.name', label]);
  must(git, ['config', 'user.email', `${label}@example.invalid`]);
  must(git, ['config', 'commit.gpgsign', 'false']);
  plantProjectConfig(repo, CONFIG);
  mintDeviceStore(repo, storeId);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, bin, callLog: join(root, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** What `branch` points at on `originGit`, or null when it has none. */
function remoteTip(originGit: GitRunner, branch: string): string | null {
  const result = originGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return result.ok
    ? result.stdout.trim()
    : null;
}

/** The latest ownership record `branch` carries on `originGit`, read straight off the bare remote. */
function tipRecord(originGit: GitRunner, branch: string): ReturnType<typeof parseClaimMessage> {
  return parseClaimMessage(must(originGit, ['log', '-1', '--format=%B', `refs/heads/${branch}`]));
}

/** Pushes a fresh `claim` commit for `store` on `branch`'s first push, from `git` in an owner's own clone. */
function plantClaim(git: GitRunner, issue: number, branch: string, store: string): string {
  const made = makeOwnershipCommit(git, 'main', { action: 'claim', issue, store });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(git, made.sha, branch);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return made.sha;
}

/**
 * Pushes a `claim` commit for `store` on `branch`'s first push, its
 * committer (and author) date `date` rather than the operator's clock:
 * how this file makes a claim stale without a seam over the real
 * `rafa claim take` this suite spawns, which reads the wall clock.
 */
function plantStaleClaim(git: GitRunner, repo: string, issue: number, branch: string, store: string, date: string): string {
  const main = must(git, ['rev-parse', 'main']);
  const message = formatClaimMessage({ action: 'claim', issue, store });
  const result = spawnSync('git', ['commit-tree', `${main}^{tree}`, '-p', main, '-m', message], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env, LC_ALL: 'C', GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date,
    },
  });
  if (result.status !== 0) throw new Error(`commit-tree: ${result.stderr}`);
  const sha = result.stdout.trim();
  const pushed = pushNewClaimBranch(git, sha, branch);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return sha;
}

describe('rafa claim release, spawned, refused by a device that does not own the claim', () => {
  it('leaves origin\'s tip unmoved and names the owner', () => {
    const dir = freshDir();
    const originPath = plantOrigin(dir);
    const deviceA = plantDevice(originPath, dir, 'device-a', 'store-a');
    const deviceB = plantDevice(originPath, dir, 'device-b', 'store-b');
    const issue = 901;
    const branch = `feat/rafa-${String(issue)}-x`;
    const claimSha = plantClaim(createGitRunner(deviceA.repo), issue, branch, 'store-a');

    const run = runRafa(deviceB, deviceB.repo, ['claim', 'release', String(issue)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ rafa claim release: this device does not own the claim on #${String(issue)}, so nothing was released:`);
    expect(run.stderr).toContain(`#${String(issue)} is claimed by store store-a on ${branch}, not by this device (store store-b)`);
    expect(remoteTip(createGitRunner(originPath), branch)).toBe(claimSha);
  }, SPAWN_TIMEOUT_MS);
});

describe('rafa claim hand --to, then rafa claim accept, spawned', () => {
  it('moves ownership from the owner to the receiver over real git', () => {
    const dir = freshDir();
    const originPath = plantOrigin(dir);
    const deviceA = plantDevice(originPath, dir, 'device-a', 'store-a');
    const deviceB = plantDevice(originPath, dir, 'device-b', 'store-b');
    const issue = 902;
    const branch = `feat/rafa-${String(issue)}-x`;
    plantClaim(createGitRunner(deviceA.repo), issue, branch, 'store-a');
    const originGit = createGitRunner(originPath);

    const handRun = runRafa(deviceA, deviceA.repo, ['claim', 'hand', String(issue), '--to=store-b']);

    expect(handRun.exitCode).toBe(0);
    expect(handRun.stdout).toContain(`Handed the claim on #${String(issue)} (store store-a) on ${branch} over to store store-b:`);
    expect(handRun.stdout).toContain(`This device stays the owner until store store-b runs rafa claim accept ${String(issue)}.`);
    const handTip = remoteTip(originGit, branch);
    expect(tipRecord(originGit, branch)).toEqual({ kind: 'ownership', record: { action: 'hand', issue, store: 'store-a', to: 'store-b' } });

    const acceptRun = runRafa(deviceB, deviceB.repo, ['claim', 'accept', String(issue)]);

    expect(acceptRun.exitCode).toBe(0);
    expect(acceptRun.stdout).toContain(`Accepted the handover of #${String(issue)} on ${branch} from store store-a:`);
    expect(acceptRun.stdout).toContain('this device (store store-b) now owns the claim.');
    const acceptTip = remoteTip(originGit, branch);
    expect(acceptTip).not.toBe(handTip);
    expect(tipRecord(originGit, branch)).toEqual({ kind: 'ownership', record: { action: 'accept', issue, store: 'store-b' } });
  }, SPAWN_TIMEOUT_MS);
});

describe('rafa claim hand --withdraw, then rafa claim accept, spawned', () => {
  it('refuses the accept once the handover has been withdrawn, naming the withdraw commit', () => {
    const dir = freshDir();
    const originPath = plantOrigin(dir);
    const deviceA = plantDevice(originPath, dir, 'device-a', 'store-a');
    const deviceB = plantDevice(originPath, dir, 'device-b', 'store-b');
    const issue = 903;
    const branch = `feat/rafa-${String(issue)}-x`;
    plantClaim(createGitRunner(deviceA.repo), issue, branch, 'store-a');
    const originGit = createGitRunner(originPath);

    const handRun = runRafa(deviceA, deviceA.repo, ['claim', 'hand', String(issue), '--to=store-b']);
    expect(handRun.exitCode).toBe(0);

    const withdrawRun = runRafa(deviceA, deviceA.repo, ['claim', 'hand', String(issue), '--withdraw']);

    expect(withdrawRun.exitCode).toBe(0);
    expect(withdrawRun.stdout).toContain(`Withdrew the handover of #${String(issue)} to store store-b on ${branch}:`);
    expect(withdrawRun.stdout).toContain('store store-a keeps the claim.');
    const withdrawTip = remoteTip(originGit, branch);
    expect(tipRecord(originGit, branch)).toEqual({ kind: 'ownership', record: { action: 'withdraw', issue, store: 'store-a' } });

    const acceptRun = runRafa(deviceB, deviceB.repo, ['claim', 'accept', String(issue)]);

    expect(acceptRun.exitCode).toBe(1);
    expect(acceptRun.stderr).toContain(`❌ rafa claim accept: no handover of #${String(issue)} to this device (store store-b) is pending, so nothing was accepted:`);
    expect(acceptRun.stderr).toContain(`the handover to this device on ${branch} was withdrawn by store store-a (commit ${withdrawTip ?? ''})`);
    expect(remoteTip(originGit, branch)).toBe(withdrawTip);
  }, SPAWN_TIMEOUT_MS);
});

describe('rafa claim take, spawned, refused on a fresh claim', () => {
  it('names how long claims.staleAfter still has to run, leaving origin untouched', () => {
    const dir = freshDir();
    const originPath = plantOrigin(dir);
    const deviceA = plantDevice(originPath, dir, 'device-a', 'store-a');
    const deviceB = plantDevice(originPath, dir, 'device-b', 'store-b');
    const issue = 904;
    const branch = `feat/rafa-${String(issue)}-x`;
    const claimSha = plantClaim(createGitRunner(deviceA.repo), issue, branch, 'store-a');

    const run = runRafa(deviceB, deviceB.repo, ['claim', 'take', String(issue)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ rafa claim take: the claim on #${String(issue)} cannot be taken over, so nothing was taken:`);
    expect(run.stderr).toContain(`#${String(issue)} is claimed by store store-a on ${branch}, idle 0h: not stale until it has stood claims.staleAfter (3d)`);
    expect(remoteTip(createGitRunner(originPath), branch)).toBe(claimSha);
  }, SPAWN_TIMEOUT_MS);
});

/**
 * Writes a stand-in `git` into `scratch`'s own `bin/`, ahead of the real
 * one on its PATH: every verb but `push` execs the real git straight
 * through, and a `push` first marks `<control>/ready` and then waits for
 * `<control>/go` before it execs — the same technique
 * `src/tests/release-settle-race-spawned-cli.test.ts`'s own
 * `plantPushGate` uses, narrowed to the one push a claim command ever
 * makes.
 */
function plantPushGate(scratch: ScratchRepo, control: string): void {
  mkdirSync(control, { recursive: true });
  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const script = [
    '#!/bin/sh',
    // Widened past the scratch PATH this script itself resolved through
    // (deliberately narrow, so `claude` resolves to nothing), so `sleep`
    // below resolves too.
    'PATH="/bin:/usr/bin:$PATH"',
    `CONTROL='${control}'`,
    `REAL_GIT='${gitBinary}'`,
    'if [ "$1" = "push" ]; then',
    '  : > "$CONTROL/ready"',
    '  while [ ! -f "$CONTROL/go" ]; do',
    '    sleep 0.02',
    '  done',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n');
  const git = join(scratch.bin, 'git');
  writeFileSync(git, script, 'utf8');
  chmodSync(git, 0o755);
}

/** Polls for `path` to exist, throwing past `timeoutMs`. */
async function waitForFile(path: string, timeoutMs = GATE_TIMEOUT_MS, pollMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await Bun.sleep(pollMs);
  }
}

/** The CLI entry an asynchronously spawned run executes; mirrors `cli-capture.ts`'s own. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/**
 * Spawns `bun src/rafa.ts` with `words` in `cwd`, under `scratch`'s PATH
 * and HOME, without waiting for it: the async twin of `runRafa`, needed
 * here because the case must act — landing the owner's work commit —
 * WHILE this run sits paused at its own gated push.
 */
function spawnRafaAsync(scratch: ScratchRepo, cwd: string, words: readonly string[]): Promise<CapturedRun> {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== null && resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${resolved}, not to the stand-in or to nothing`);
  }
  const proc = Bun.spawn([process.execPath, RAFA_ENTRY, ...words], {
    cwd,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, HOME: scratch.home },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return (async (): Promise<CapturedRun> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  })();
}

/** Fetches `branch` into a local branch of the same name, checks it out, adds one work commit and pushes it. */
function ownerPushesWork(git: GitRunner, repo: string, branch: string): string {
  must(git, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/heads/${branch}`]);
  must(git, ['checkout', '--quiet', branch]);
  writeFileSync(join(repo, 'work-commit.txt'), 'still working\n', 'utf8');
  must(git, ['add', 'work-commit.txt']);
  must(git, ['commit', '--quiet', '-m', 'owner still working']);
  must(git, ['push', '--quiet', 'origin', branch]);
  return must(git, ['rev-parse', branch]);
}

/** A committer date well past the default `claims.staleAfter` (3d): five days ago. */
const STALE_DATE = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString();

describe('rafa claim take --stale, spawned, racing the owner\'s own push', () => {
  it(
    'is refused by the lease once the owner\'s push lands first, and origin keeps the owner\'s work commit',
    async () => {
      const dir = freshDir();
      const originPath = plantOrigin(dir);
      const deviceA = plantDevice(originPath, dir, 'device-a', 'store-a');
      const deviceB = plantDevice(originPath, dir, 'device-b', 'store-b');
      const issue = 905;
      const branch = `feat/rafa-${String(issue)}-x`;
      plantStaleClaim(createGitRunner(deviceA.repo), deviceA.repo, issue, branch, 'store-a', STALE_DATE);
      const originGit = createGitRunner(originPath);

      const control = join(dir, 'control');
      plantPushGate(deviceB, control);
      const taking = spawnRafaAsync(deviceB, deviceB.repo, ['claim', 'take', String(issue), '--stale']);

      // `b` has fetched, read the stale claim as takeable and reached its
      // own push, but not yet run it — the lease it is about to push is
      // still the claim commit alone.
      await waitForFile(join(control, 'ready'));

      const workSha = ownerPushesWork(createGitRunner(deviceA.repo), deviceA.repo, branch);
      writeFileSync(join(control, 'go'), '');

      const taken = await taking;

      expect(taken.exitCode).toBe(1);
      expect(taken.stderr).toContain(`❌ rafa claim take: ${branch} moved on origin while the claim on #${String(issue)} was being taken over; nothing was taken. Run it again to read the branch afresh`);
      expect(remoteTip(originGit, branch)).toBe(workSha);
      expect(tipRecord(originGit, branch)).toEqual({ kind: 'work' });
    },
    SPAWN_TIMEOUT_MS,
  );
});
