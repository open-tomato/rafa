/**
 * `rafa loop start`, spawned as the real `rafa` binary
 * (`src/tests/cli-capture.ts`), over a claim another clone takes while
 * the first one's own run is still going — the scenario
 * `src/start/pr-lifecycle.test.ts`'s `refusedPushReaderIn, over a bare
 * remote and two clones` already drives over the gate's functions
 * in-process, proven here over the whole command line instead
 * (`.rafa/plans/rafa-324-claim-issue-so-two`).
 *
 * `device-a` owns a claim already stale (its one commit backdated, as
 * `src/tests/claim-commands-spawned.test.ts`'s own `plantStaleClaim`
 * does) and runs its one-task loop with `pr.provider: none` and no
 * `--no-ci-wait`, which skips `verifyPullRequest` — the gate this file
 * means to reach — altogether (`src/start.ts`); with `pr.provider: none`
 * that gate still costs no network, since it only pushes the branch
 * itself rather than opening a pull request (`src/pr/none.ts`). One
 * stand-in `claude` answers both of the run's real sessions, the task's
 * and the wrap-up's: each writes a tracked marker file, for the loop's
 * own `commitTaskWork` to commit, and — the first time only, an idle
 * marker file guarding the second — spawns `device-b`'s real
 * `rafa claim take --stale` as a nested `rafa` process of its own, over
 * `device-b`'s PATH and HOME, so the takeover lands on `origin` while
 * `device-a`'s run is still going. By the time `device-a`'s wrap-up
 * push runs, `origin`'s tip is `device-b`'s take commit, a commit the
 * local `feat/<stub>` does not carry: git refuses the push as it
 * refuses any tip that is not a fast-forward, and the gate's own
 * reading of that refusal (`src/claims/lost.ts`) is what this file
 * proves end to end.
 *
 * Four facts, each read off something neither run's own stdout can be
 * mistaken for:
 *
 *   - `device-a`'s run halts with the "claim lost" report and exit
 *     code 1, printed to stderr as every `CommandExit` is.
 *   - `device-a`'s own commits — the claim commit and the marker
 *     file's commit `commitTaskWork` made — are kept on the local
 *     `lost/<stub>`, read off `device-a`'s own repository.
 *   - `origin`'s tip, read off the bare remote itself, is still
 *     `device-b`'s take commit: nothing was force-pushed over it.
 *   - `rafa status`, run on BOTH clones, names `device-b`'s store as
 *     the claim's owner: on `device-a` because the gate's own refused
 *     fetch (`readRefusedPush`) already moved its remote-tracking ref,
 *     and on `device-b` because its own push did.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { GitRunner } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { pushNewClaimBranch } from '../claims/git.js';
import { formatClaimMessage } from '../claims/record.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/index.js';

import { expectExit, plantProjectConfig, runRafa } from './cli-capture.js';

/** This suite's own temporary directory, removed once its one case has run. */
const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-wrap-up-claim-lost-spawned-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** How long the spawned loop run, dispatching one real session, may take. */
const SPAWN_TIMEOUT_MS = 90_000;

/** The issue `device-a` claims, and the branch and stub its claim lives on. */
const ISSUE = 950;
const STUB = 'rafa-950-claim-lost-wrap-up';
const BRANCH = `feat/${STUB}`;
const LOST_BRANCH = `lost/${STUB}`;
const STORE_A = 'store-a-3f1c9e';
const STORE_B = 'store-b-8a4d21';

/** No `gh` is ever reached: the wrap-up gate takes the `none` provider's push path. */
const CONFIG = 'pr:\n  provider: none\n';

/** A claim committer date five days back: well past the default `claims.staleAfter` (3d). */
const STALE_DATE = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString();

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
  return result.stdout.trim();
}

/** A bare `origin` under `dir`, holding one commit on `main`, ignoring `.rafa/` and `progress.txt`. */
function plantOrigin(dir: string): string {
  const originPath = join(dir, 'origin.git');
  must(createGitRunner(dir), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seed = join(dir, 'seed');
  must(createGitRunner(dir), ['clone', '--quiet', originPath, seed]);
  const seedGit = createGitRunner(seed);
  must(seedGit, ['config', 'user.name', 'seed']);
  must(seedGit, ['config', 'user.email', 'seed@example.invalid']);
  must(seedGit, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(seed, '.gitignore'), '.rafa/\nprogress.txt\n', 'utf8');
  must(seedGit, ['add', '--all']);
  must(seedGit, ['commit', '--quiet', '-m', 'root']);
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

/**
 * Pushes a `claim` commit for `store` on `branch`'s first push, its
 * committer (and author) date `date` rather than the operator's clock —
 * the technique `src/tests/claim-commands-spawned.test.ts`'s own
 * `plantStaleClaim` uses, needed here because this suite spawns the real
 * `rafa claim take`, which reads the wall clock. Answers the commit.
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

/** The plan `device-a` runs: one open task, its stub naming {@link ISSUE}. */
function planText(): string {
  return [
    `# Plan: ${STUB}`,
    '',
    '```rafa:plan',
    `stub: ${STUB}`,
    '```',
    '',
    '- [ ] Do the thing',
    '',
  ].join('\n');
}

/** `.rafa/plans/PLAN-<stub>.md`, relative to a repository root. */
const PLAN_FLAG = `--plan=.rafa/plans/PLAN-${STUB}.md`;

/** The plan path under `repo`'s `.rafa/plans`. */
function planPathUnder(repo: string): string {
  return join(repo, '.rafa', 'plans', `PLAN-${STUB}.md`);
}

/** The report the stand-in session answers with: `done`, holding nothing back. */
const STAND_IN_REPORT = [
  '```rafa:report',
  'status: done',
  'feedback: "the stand-in answered"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  '```',
  '',
].join('\n');

/** The CLI entry the nested takeover call, spawned from inside `device-a`'s own session, executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/**
 * Writes a stand-in `claude` into `deviceA`'s `bin/`, answering both
 * the task session and the wrap-up session the real loop spawns: each
 * call writes a tracked marker file (left for the loop's own
 * `commitTaskWork` to commit, never committing it itself) and answers
 * {@link STAND_IN_REPORT}. On its first call only — a marker file beside
 * `takeoverLogPath` guards the second — it also spawns `deviceB`'s real
 * `rafa claim take <issue> --stale` as a nested process over `deviceB`'s
 * own PATH and HOME, landing the takeover on `origin` while `deviceA`'s
 * run is still going. `takeoverLogPath` collects that nested run's
 * combined output, read back once the outer run has finished.
 */
function plantSessionClaudeWithTakeover(deviceA: ScratchRepo, deviceB: ScratchRepo, reportPath: string, takeoverLogPath: string): void {
  const claude = join(deviceA.bin, 'claude');
  const takenMarker = `${takeoverLogPath}.done`;
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'echo "device-a work, still uncommitted" > claim-lost-work.txt',
    `echo session-call >> '${deviceA.callLog}'`,
    // The loop calls this stand-in for the task's session and again for
    // its wrap-up session; the takeover only needs to land once.
    `if [ ! -f '${takenMarker}' ]; then`,
    `  (cd '${deviceB.repo}' && RAFA_TEST=1 TMPDIR='${tmpdir()}' PATH='${deviceB.path}' HOME='${deviceB.home}'`
      + ` '${process.execPath}' '${RAFA_ENTRY}' claim take ${String(ISSUE)} --stale) > '${takeoverLogPath}' 2>&1`,
    `  touch '${takenMarker}'`,
    'fi',
    `cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

describe('a loop whose claim is taken over mid-session, spawned', () => {
  it(
    'halts the wrap-up push with the claim lost report, keeps device-a\'s commits on lost/<stub>,'
      + ' leaves the new owner\'s tip unmoved on origin, and rafa status on both clones names the new owner',
    () => {
      const originPath = plantOrigin(scope);
      const deviceA = plantDevice(originPath, scope, 'device-a', STORE_A);
      const deviceB = plantDevice(originPath, scope, 'device-b', STORE_B);
      const deviceAGit = createGitRunner(deviceA.repo);
      const originGit = createGitRunner(originPath);

      const claimSha = plantStaleClaim(deviceAGit, deviceA.repo, ISSUE, BRANCH, STORE_A, STALE_DATE);
      must(deviceAGit, ['switch', '--quiet', '-C', BRANCH, claimSha]);
      mkdirSync(join(deviceA.repo, '.rafa', 'plans'), { recursive: true });
      writeFileSync(planPathUnder(deviceA.repo), planText(), 'utf8');

      const reportPath = join(deviceA.bin, 'report.txt');
      writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
      const takeoverLogPath = join(scope, 'takeover.log');
      plantSessionClaudeWithTakeover(deviceA, deviceB, reportPath, takeoverLogPath);

      const loopRun = runRafa(deviceA, deviceA.repo, ['loop', 'start', PLAN_FLAG]);

      // The nested takeover, spawned from inside device-a's own session, ran and landed.
      const takeoverOutput = existsSync(takeoverLogPath)
        ? readFileSync(takeoverLogPath, 'utf8')
        : '';
      expect(takeoverOutput).toContain(`Took over the claim on #${String(ISSUE)} on ${BRANCH}`);
      expect(takeoverOutput).toContain(`this device (store ${STORE_B}) now owns the claim.`);

      // device-a's own run halts with the "claim lost" report instead of finishing.
      expectExit(loopRun, 1, deviceA);
      expect(loopRun.stderr).toContain(
        `❌ Claim lost: #${String(ISSUE)} is claimed by store ${STORE_B} on ${BRANCH}, not by this device (store ${STORE_A}).`,
      );
      expect(loopRun.stderr).toContain(`refused the push of ${BRANCH}, and nothing was force-pushed over store ${STORE_B}'s branch.`);
      expect(loopRun.stderr).toContain(`kept on the local branch ${LOST_BRANCH}`);
      expect(loopRun.stderr).toContain(`no pull request is opened for ${BRANCH}`);

      // device-a's own commits — the claim commit and the marker file's — are kept on lost/<stub>.
      const localTip = must(deviceAGit, ['rev-parse', `refs/heads/${BRANCH}`]);
      const lostTip = must(deviceAGit, ['rev-parse', `refs/heads/${LOST_BRANCH}`]);
      expect(lostTip).toBe(localTip);
      expect(localTip).not.toBe(claimSha);
      expect(must(deviceAGit, ['log', '-1', '--format=%s', LOST_BRANCH])).not.toBe('root');

      // origin's tip, read off the bare remote itself, is still device-b's take commit.
      const takeTip = must(originGit, ['rev-parse', `refs/heads/${BRANCH}`]);
      expect(takeTip).not.toBe(claimSha);
      expect(takeTip).not.toBe(localTip);

      // rafa status on device-a: its own refused push already fetched the remote, so no fetch is run here.
      const statusA = runRafa(deviceA, deviceA.repo, ['status']);
      expectExit(statusA, 0, deviceA);
      expect(`${statusA.stdout}${statusA.stderr}`).toContain(`#${String(ISSUE)} \`${BRANCH}\`: owned by store ${STORE_B}`);

      // rafa status on device-b, fetched once more as any clone would before reading its own claims.
      const deviceBGit = createGitRunner(deviceB.repo);
      must(deviceBGit, ['fetch', '--quiet', 'origin']);
      const statusB = runRafa(deviceB, deviceB.repo, ['status']);
      expectExit(statusB, 0, deviceB);
      expect(`${statusB.stdout}${statusB.stderr}`).toContain(`#${String(ISSUE)} \`${BRANCH}\`: owned by store ${STORE_B}`);
    },
    SPAWN_TIMEOUT_MS,
  );
});
