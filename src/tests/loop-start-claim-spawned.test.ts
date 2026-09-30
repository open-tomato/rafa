/**
 * `rafa plan create` and `rafa loop start`, spawned as the real `rafa`
 * binary (`src/tests/cli-capture.ts`), driving the offline half of the
 * claim story `src/tests/plan-claim-race-spawned.test.ts` leaves untried:
 * a plan written with no reachable `origin` at all, `loop start` pushing
 * that pending claim before any session, and a second clone refused for
 * a claim it does not hold (`.rafa/plans/rafa-324-claim-issue-so-two`).
 *
 * One flow, three phases, over one device (`device-a`) and a second
 * clone (`device-b`) planted only once `device-a`'s claim has actually
 * landed on the bare `origin`:
 *
 *   1. `device-a`'s `origin` is pointed at a path that is not a
 *      repository before `plan create` ever runs, so its one fetch fails
 *      the way an unreachable network would. The claim commit is made
 *      anyway and left on the local `feat/<stub>`, with no upstream and
 *      no trace on `origin`, and the run still writes the plan behind an
 *      "unclaimed" warning — `plan-claim.ts`'s module note, "no push".
 *   2. `origin` is pointed back, `device-a` checks out the `feat/<stub>`
 *      it already holds locally, and `rafa loop start` is spawned over a
 *      stand-in `claude`: its preflight retries the pending claim
 *      (`start/preflight-claim.ts`'s `pushWaiting`) before the plan's one
 *      task is ever dispatched, so a run that reaches a session at all —
 *      the stand-in's call log holding `session-call` beside its plan
 *      phase's own `plan-call`, and the tracker's task ticked — is proof
 *      the push already landed.
 *   3. `device-b`, a fresh clone taken only after that push, reads
 *      `origin`'s `feat/<stub>` as `device-a`'s and is refused before any
 *      probe and any session: its own stand-in `claude` is never run.
 *
 * Every check reads what `origin` itself holds, never a clone's own
 * refs, and the plan text and the `PLAN-<stub>.md` naming both devices
 * share are literals, not read back from either run: `planStubFromPath`
 * (`utils/plan-stamp.ts`) takes the stub from the file name alone, so
 * `device-b`'s plan needs no `rafa:plan` block to be read by the claim
 * check that refuses before the plan is ever parsed for tasks.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { GitRunner } from '../pr/index.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { branchName, planStub } from '../board/naming.js';
import { parseClaimMessage } from '../claims/record.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/index.js';
import { REMOTE } from '../start/branch-decision.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';

/** This suite's own temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-start-claim-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The one issue `device-a` plans, and the branch its claim lives on. */
const ISSUE = 881;
const TITLE = 'Claim before loop start';
const STUB = planStub(ISSUE, TITLE);
const BRANCH = branchName(ISSUE, TITLE);
const STORE_A = 'store-a-9c14f0';
const STORE_B = 'store-b-2e7a63';

/** The spec `device-a` plans from, its name alone naming the issue. */
const SPEC_FILE = `${STUB}.md`;
const SPEC_TEXT = '# Spec: claim before loop start\n\nNothing to build.\n';

/** The config every device holds: no `gh`, so a claim touches no board. */
const CONFIG = 'pr:\n  provider: none\n';

/** Runs git in `dir`, throwing what it said when it failed: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
  return result.stdout.trim();
}

/** A bare `origin` under this suite's directory, holding one commit on `main` ignoring `.rafa/`. */
function plantOrigin(): string {
  const root = realpathSync(mkdtempSync(join(tempBase, 'origin-')));
  const originPath = join(root, 'origin.git');
  must(createGitRunner(root), ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);

  const seed = join(root, 'seed');
  must(createGitRunner(root), ['clone', '--quiet', originPath, seed]);
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
 * Mints the effort store at `repo` under a store id of its own: a
 * writing open with no rows, so `readDeviceStoreId` answers `storeId`
 * for a run in `repo` with no row of its own written first.
 * `readProject` is left at its real default, so the mint records the
 * clone's actual git root commit rather than a placeholder.
 */
function mintDeviceStore(repo: string, storeId: string): void {
  withSqliteStore(sqliteStorePath(repo), 'write', true, () => undefined, {
    newStoreId: () => storeId,
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  });
}

/** One device: a clone of `originPath`, its own store id, bin, home and call log. */
function plantDevice(originPath: string, label: string, storeId: string): ScratchRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, `${label}-`)));
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

/** Writes and commits `SPEC_FILE` at `scratch`'s repository root. */
function writeSpec(scratch: ScratchRepo): void {
  writeFileSync(join(scratch.repo, SPEC_FILE), SPEC_TEXT, 'utf8');
  const git = createGitRunner(scratch.repo);
  must(git, ['add', SPEC_FILE]);
  must(git, ['commit', '--quiet', '-m', 'spec']);
}

/** The plan text both devices write for {@link STUB}: one open task, "Do the thing". */
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

/** The tracker path beside the plan under `repo`'s `.rafa/plans`. */
function trackerPathUnder(repo: string): string {
  return join(repo, '.rafa', 'plans', `PLAN_TRACKER-${STUB}.md`);
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/` that reads its
 * stdin, writes `PLAN-<stub>.md` under its own `.rafa/plans`, logs
 * `plan-call` and exits 0 — the shape `plan-claim-race-spawned.test.ts`'s
 * own `plantPlanningClaude` writes.
 */
function plantPlanningClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'mkdir -p .rafa/plans',
    `cat > .rafa/plans/PLAN-${STUB}.md <<'PLAN_EOF'`,
    planText(),
    'PLAN_EOF',
    `echo plan-call >> '${scratch.callLog}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** The report a stand-in session ends on: `done`, holding nothing back. */
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

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/` that reads its
 * stdin, logs `session-call` and answers {@link STAND_IN_REPORT}: what a
 * task session leaves behind, distinct from {@link plantPlanningClaude}'s
 * own `plan-call` marker so the two phases can be told apart in one call
 * log.
 */
function plantSessionClaude(scratch: ScratchRepo): void {
  const reportPath = join(scratch.bin, 'report.txt');
  writeFileSync(reportPath, STAND_IN_REPORT, 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo session-call >> '${scratch.callLog}'`,
    `cat '${reportPath}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** Every call marker `scratch`'s stand-in `claude` logged, in order. */
function claudeCalls(scratch: ScratchRepo): string[] {
  if (!existsSync(scratch.callLog)) return [];
  return readFileSync(scratch.callLog, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/** The ownership record a claim commit `sha` on `origin` carries, or the message's own kind. */
function recordAt(origin: GitRunner, sha: string): unknown {
  const reading = parseClaimMessage(must(origin, ['log', '-1', '--format=%B', sha]));
  return reading.kind === 'ownership'
    ? reading.record
    : reading.kind;
}

describe('a plan written with no reachable remote, then loop start over its pending claim', () => {
  it('warns unclaimed, pushes the claim before any session, and refuses a clone that does not own it', () => {
    const originPath = plantOrigin();
    const deviceA = plantDevice(originPath, 'device-a', STORE_A);
    writeSpec(deviceA);
    plantPlanningClaude(deviceA);

    const badRemote = join(tempBase, 'nowhere-does-not-exist.git');
    const deviceAGit = createGitRunner(deviceA.repo);
    must(deviceAGit, ['remote', 'set-url', 'origin', badRemote]);

    // Phase 1: `plan create` over an unreachable origin warns unclaimed,
    // still writes the plan, and leaves the claim commit local only.
    const planRun = runRafa(deviceA, deviceA.repo, ['plan', 'create', `--spec=${SPEC_FILE}`, '--no-progress']);
    const planOutput = `${planRun.stdout}${planRun.stderr}`;

    expect(planRun.exitCode).toBe(0);
    expect(planOutput).toContain(`⚠️  Planning issue #${String(ISSUE)} unclaimed: the claim on #${String(ISSUE)} was not pushed:`);
    expect(planOutput).toContain(`It waits on the local ${BRANCH} for rafa loop start to push`);
    expect(planOutput).toContain(`✅ Plan ready: .rafa/plans/PLAN-${STUB}.md`);
    expect(existsSync(planPathUnder(deviceA.repo))).toBe(true);
    expect(claudeCalls(deviceA)).toEqual(['plan-call']);

    const localTip = must(deviceAGit, ['rev-parse', `refs/heads/${BRANCH}`]);
    expect(deviceAGit(['rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`]).ok).toBe(false);
    const originGit = createGitRunner(originPath);
    expect(originGit(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).ok).toBe(false);

    // Phase 2: origin reachable again, `loop start` pushes the pending
    // claim in its preflight before the plan's one task is dispatched.
    must(deviceAGit, ['remote', 'set-url', 'origin', originPath]);
    must(deviceAGit, ['checkout', '--quiet', BRANCH]);
    plantSessionClaude(deviceA);

    const loopRunA = runRafa(deviceA, deviceA.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);
    const loopOutputA = `${loopRunA.stdout}${loopRunA.stderr}`;

    expect(loopRunA.exitCode).toBe(0);
    expect(loopOutputA).toContain(`🔒 Pushed the claim on #${String(ISSUE)} to ${REMOTE}/${BRANCH} for store ${STORE_A}.`);

    const pushedTip = must(originGit, ['rev-parse', `refs/heads/${BRANCH}`]);
    expect(pushedTip).toBe(localTip);
    expect(recordAt(originGit, pushedTip)).toEqual({ action: 'claim', issue: ISSUE, store: STORE_A });
    const callsA = claudeCalls(deviceA);
    expect(callsA[0]).toBe('plan-call');
    expect(callsA.slice(1)).toEqual(callsA.slice(1).map(() => 'session-call'));
    expect(callsA.length).toBeGreaterThan(1);
    expect(readFileSync(trackerPathUnder(deviceA.repo), 'utf8')).toContain('- [x] Do the thing');

    // Phase 3: a fresh clone taken only now, reading origin's claim as
    // device-a's, is refused before any probe and any session.
    const deviceB = plantDevice(originPath, 'device-b', STORE_B);
    const deviceBGit = createGitRunner(deviceB.repo);
    must(deviceBGit, ['fetch', '--quiet', 'origin']);
    must(deviceBGit, ['checkout', '--quiet', '-b', BRANCH, `origin/${BRANCH}`]);
    mkdirSync(join(deviceB.repo, '.rafa', 'plans'), { recursive: true });
    writeFileSync(planPathUnder(deviceB.repo), planText(), 'utf8');

    const loopRunB = runRafa(deviceB, deviceB.repo, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

    expect(loopRunB.exitCode).toBe(1);
    expect(loopRunB.stderr).toContain(`❌ Refusing to start: this device does not own the claim on #${String(ISSUE)}.`);
    expect(loopRunB.stderr).toContain(`#${String(ISSUE)} is claimed by store ${STORE_A} on ${BRANCH}`);
    expect(loopRunB.stderr).toContain(`not by this device (store ${STORE_B})`);
    expect(loopRunB.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(claudeCalls(deviceB)).toEqual([]);
  }, 90_000);
});
