/**
 * `rafa plan create --issue <n>`, spawned twice as the real `rafa` binary
 * (`src/tests/cli-capture.ts`) from two separate clones of one bare
 * remote, each its own device: this is the proof that the compare-and-set
 * `src/claims/plan-claim.ts` documents actually holds over REAL git, not
 * only over the fakes `src/claims/plan-claim.test.ts` and
 * `src/commands/plan/claim-route.test.ts` drive.
 *
 * `src/board/roadmap-claims-remote.test.ts` already proves the READING
 * side of a claim branch over a real bare remote; this file drives the
 * WRITING side end to end, spawned exactly as an operator's shell would
 * run it: two clones, each with its own minted effort store (so each
 * names a store id of its own) and its own stand-in `gh` and `claude` on
 * its PATH. Clone A plants the claim first and plans past it; clone B
 * runs second, its fetch reading the branch clone A already pushed, so
 * its claim is refused before a session is ever spawned — the module
 * note's "a lost race costs no session" — and its own call log, kept
 * beside its own stand-in `claude`, stays empty to prove it.
 *
 * Both clones resolve the SAME issue and title, so `planStub` and
 * `branchName` (`src/board/naming.ts`) compute the same stub and the
 * same claim branch for each of them without either one being told the
 * other's answer; that is what makes the second clone's claim collide
 * with the first's rather than land on a branch of its own.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { SpecIssue } from '../board/issue.js';
import type { GitRunner } from '../pr/index.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { branchName, planStub } from '../board/naming.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/index.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's own temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-claim-race-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The one issue both clones plan, and the author check 0 must trust. */
const ISSUE = 771;
const TITLE = 'Two devices race the same claim';
const AUTHOR = 'octocat';
const ISSUE_BODY = completeSpecBody(TITLE);

/** The stub and the claim branch both clones compute for {@link ISSUE}; see the module note. */
const STUB = planStub(ISSUE, TITLE);
const BRANCH = branchName(ISSUE, TITLE);

/** Runs git in `dir`, throwing what it said when it failed: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} in a fixture step: ${result.stderr}`);
  return result.stdout.trim();
}

/** A bare `origin` under this suite's directory, holding one commit on `main`. */
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
  must(seedGit, ['commit', '--quiet', '--allow-empty', '-m', 'root']);
  must(seedGit, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return originPath;
}

/**
 * Mints the effort store at `repo` under a store id of its own: a
 * writing open with no rows, exactly as `src/tests/merged-stores.ts`'s
 * `freshDevice` mints one, so `readDeviceStoreId` (`src/claims/device.ts`)
 * answers `storeId` for a run in `repo` without either clone's run
 * having to write a row of its own first. `readProject` is left at its
 * real default (git's own root commit of `repo`), not a placeholder: a
 * later writing open the spawned run makes reads that same real commit,
 * so nothing here reads as a copy and re-mints under a second id.
 */
function mintDeviceStore(repo: string, storeId: string): void {
  withSqliteStore(sqliteStorePath(repo), 'write', true, () => undefined, {
    newStoreId: () => storeId,
    now: () => new Date('2026-09-30T12:00:00.000Z'),
  });
}

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/**
 * Writes a stand-in `gh` into `bin` answering `gh issue view <n>` for
 * `issue` and check 0's own trust read
 * (`gh api repos/{owner}/{repo}/collaborators/<login>/permission`, which
 * both clones' resolutions send unchanged, literal placeholders and
 * all): everything else the board route could ask for `--issue` is
 * outside those two calls (`src/board/issue.ts`, `src/board/trust.ts`).
 */
function writeIssueGh(bin: string, issue: SpecIssue): void {
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(issue.number)}" ]; then`,
    `  printf '%s' '${shellQuoted({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((name) => ({ name })),
      author: { login: issue.author },
    })}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${issue.author}/permission" ]; then`,
    `  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/` that reads its
 * stdin, writes `PLAN-<stub>.md` under `.rafa/plans` relative to its own
 * working directory, logs the call and exits 0 — the same shape
 * `plan-worktree-integration.test.ts`'s `plantPlanningClaude` writes, so
 * a run that reaches a session at all leaves proof of it in the call log
 * and a plan on disk, and a run that never reaches one leaves neither.
 */
function plantPlanningClaude(scratch: ScratchRepo, stub: string): void {
  const claude = join(scratch.bin, 'claude');
  const plan = [
    `# Plan: ${stub}`,
    '',
    '```rafa:plan',
    `stub: ${stub}`,
    '```',
    '',
    '- [ ] Do the thing',
    '',
  ].join('\n');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'mkdir -p .rafa/plans',
    `cat > .rafa/plans/PLAN-${stub}.md <<'PLAN_EOF'`,
    plan,
    'PLAN_EOF',
    `echo called >> '${scratch.callLog}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** One device: a clone of `originPath`, its own store id, its own bin, home and call log. */
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
  plantProjectConfig(repo);
  mintDeviceStore(repo, storeId);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const scratch: ScratchRepo = { repo, home, bin, callLog: join(root, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
  writeIssueGh(bin, { number: ISSUE, title: TITLE, body: ISSUE_BODY, state: 'OPEN', labels: [SPEC_LABEL, SPEC_READY_LABEL], author: AUTHOR });
  plantPlanningClaude(scratch, STUB);
  return scratch;
}

/** Whether `scratch`'s stand-in `claude` was ever run: its call log holds a line, or does not exist. */
function claudeWasCalled(scratch: ScratchRepo): boolean {
  return existsSync(scratch.callLog) && readFileSync(scratch.callLog, 'utf8').trim() !== '';
}

/** The plan path `PLAN-<stub>.md` is written to, under `repo`'s `.rafa/plans`. */
function planPathUnder(repo: string): string {
  return join(repo, '.rafa', 'plans', `PLAN-${STUB}.md`);
}

describe('two clones of one bare remote plan create --issue for the same issue', () => {
  it('lands the claim on the first clone, and refuses the second naming the first store, its call log staying empty', () => {
    const originPath = plantOrigin();
    const deviceA = plantDevice(originPath, 'device-a', 'store-a-2b6f19');
    const deviceB = plantDevice(originPath, 'device-b', 'store-b-7d40e2');

    const runA = runRafa(deviceA, deviceA.repo, ['plan', 'create', `--issue=${String(ISSUE)}`, '--no-progress']);

    expect(runA.exitCode).toBe(0);
    expect(runA.stdout).toContain(`🔒 Claimed #${String(ISSUE)} on ${BRANCH} for store store-a-2b6f19.`);
    expect(runA.stdout).toContain(`✅ Plan ready: .rafa/plans/PLAN-${STUB}.md`);
    expect(existsSync(planPathUnder(deviceA.repo))).toBe(true);
    expect(claudeWasCalled(deviceA)).toBe(true);

    const runB = runRafa(deviceB, deviceB.repo, ['plan', 'create', `--issue=${String(ISSUE)}`, '--no-progress']);

    expect(runB.exitCode).toBe(1);
    expect(runB.stderr).toContain(`❌ Refusing to plan issue #${String(ISSUE)}:`);
    expect(runB.stderr).toContain(`#${String(ISSUE)} is claimed by store store-a-2b6f19 on ${BRANCH}`);
    expect(runB.stderr).toContain('No session was started.');
    expect(existsSync(planPathUnder(deviceB.repo))).toBe(false);
    expect(claudeWasCalled(deviceB)).toBe(false);
  }, 30_000);
});
