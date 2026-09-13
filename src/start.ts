#!/usr/bin/env bun

/**
 * ralph start — the task loop.
 *
 * Walks the plan's tracker checklist one task at a time, delegating each task
 * to a Claude Code session and then staging and committing whatever that
 * session left in the tree. `[x]` is marked once git has answered; `[BLOCKED]`
 * on a failed or interrupted session, and on a commit git refused. Re-running
 * resumes: blocked tasks are retried first.
 *
 * A task line may carry a trailing routing declaration (`utils/declaration.ts`).
 * The loop reads it, dispatches that task under the flags it names, and keeps
 * the block out of everything downstream — the prompt, the operator's log and
 * the commit message all see the task sentence alone. A `rafa:*` block is kept
 * out of the same places at the source: `findNextTask` never answers a task
 * line inside a closed one (`utils/tracker.ts`), so no block text becomes a
 * task to quote.
 *
 * How much of the plan a task session is handed is the run's injection mode
 * (`plan/inject.ts`): `full` hands over the plan as it stands, `stage` the plan
 * context plus the task's stage, `task` the plan context plus the task line.
 * The mode is resolved once, before the run is deferred, from `--inject=`
 * over `.rafa/config.yaml` over the default (`config.ts`), and a value no mode
 * answers to refuses the run. Every part of the plan `parsePlan` does not read
 * as written is named to the operator once, at start.
 *
 * Each task session is spawned under an id the loop picks, with its stdout
 * captured (`runTaskSession`). Once the loop knows what became of the task,
 * `done`, `blocked` or `failed`, the `rafa:report` block that output ends
 * with is read and stored: its findings, blockers and out-of-scope bugs, or,
 * with no block the loop could read, one telemetry row saying why
 * (`report/record.ts`). Before every dispatch, the wrap-up's included,
 * `progress.txt` is rendered from the stored findings (`utils/progress.ts`).
 * A store the loop cannot read or write stops the run: before a dispatch,
 * nothing is dispatched; after a task, its commit and its tick stand.
 *
 *   bun src/rafa.ts start [--plan=PLAN-foo.md] [--start-at=HH:MM] [--inject=stage]
 *
 * --plan        plan file to execute (default: PLAN.md at the repo root). The
 *               tracker is derived per plan (PLAN-foo.md → PLAN_TRACKER-foo.md)
 *               so several plans can coexist.
 * --start-at    defer the run until a local time of day (e.g. 23:00) — queue
 *               off-hours runs without cron.
 * --inject      how much of the plan each task session is handed: full, stage
 *               or task. Outranks `plan.inject` in `.rafa/config.yaml`. The
 *               wrap-up session is handed the whole plan whatever it says.
 * --no-ci-wait  finish at the push instead of waiting for CI.
 * --ci-timeout  minutes to wait for checks to settle (default 20).
 * --ci-attempts repair sessions to spend on a red or conflicting PR
 *               before escalating (default 2; 0 disables repair but
 *               still reports the verdict).
 *
 * After the last task the loop runs a wrap-up session (promote findings,
 * sync with main, commit, push, open or update the PR) and then WAITS on
 * that PR's checks. A conflicting PR gets no CI run at all, so without
 * this last stage the loop can report a finished plan whose code was
 * never checked once.
 */
import type { ConfigSource, InjectMode, ResolvedConfig } from './config.js';
import type { FindingOutcome } from './effort/store/findings.js';
import type { PlanInjection, PlanIssue } from './plan/index.js';
import type { CapturedSession, CapturingSpawner } from './utils/claude.js';
import type { CommitAttempt, CommitOptions } from './utils/commit.js';
import type { TaskDeclaration } from './utils/declaration.js';
import type { TaskInfo } from './utils/tracker.js';

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigError, loadConfig } from './config.js';
import { parsePlan, renderInjection } from './plan/index.js';
import { describeTaskReportRecord, recordTaskReport } from './report/record.js';
import { runClaude, runClaudeCaptured, checkUsage } from './utils/claude.js';
import { commitTaskWork } from './utils/commit.js';
import {
  parseTaskDeclaration,
  resolveDeclarationFlags,
  stripTaskDeclaration,
} from './utils/declaration.js';
import { getCurrentBranch, getRepoRoot } from './utils/git.js';
import { planStubFromPath, stampPrompt } from './utils/plan-stamp.js';
import {
  failingRows,
  findOpenPullRequest,
  formatRows,
  isGhUsable,
  probeChecks,
  readMergeState,
  waitForChecks,
} from './utils/pr.js';
import { PROGRESS_CAP_BYTES, writeProgress } from './utils/progress.js';
import { deferUntil } from './utils/schedule.js';
import { findNextTask, trackerPathFor, updateTrackerLine } from './utils/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let interrupted = false;

/**
 * The plan this run is executing, or null when nothing set one.
 *
 * Module state rather than a threaded argument because it is read by
 * four prompt builders whose signatures are driven directly by tests,
 * and a fifth parameter on each would change every one of those call
 * sites to carry a value none of them is about. Null is the default
 * and {@link withStamp} is then the identity, so a builder called
 * from a test dispatches the exact bytes it dispatched before
 * stamping existed.
 */
let activePlanStub: string | null = null;

/** Sets the plan every prompt this run dispatches is stamped with. */
export function setActivePlanStub(stub: string | null): void {
  activePlanStub = stub;
}

/** Stamps a prompt with the active plan, or returns it unchanged. */
function withStamp(prompt: string): string {
  return activePlanStub === null
    ? prompt
    : stampPrompt(activePlanStub, prompt);
}

/** Branches a plan run is refused on. */
const DEFAULT_BRANCHES: readonly string[] = ['main', 'master'];

/**
 * Refuses to run a plan on the default branch, and warns on a branch
 * that names no plan.
 *
 * Measured: one run executed on `main`. It produced 21 commits and 74
 * sessions and cost three things — no PR, so the wrap-up's CI stage
 * found nothing to verify and skipped itself; no review; and, before
 * prompts carried a plan stamp, no per-plan attribution, its sessions
 * landing in the `main` group beside every other main-branch session
 * ever recorded.
 *
 * A refusal rather than a warning, because the only signal the mistake
 * produced at the time was silence, and a warning in a loop nobody
 * watches is the same silence one line longer. `--any-branch` is the
 * whole of the escape hatch, so an operator who means it says so once.
 *
 * The branch-names-the-plan check is only a WARNING, and deliberately.
 * A branch stub is not a plan stub — measured across eleven
 * plan-driven branches, five named their plan differently
 * (`feat/q17-dynamic-forms` against `q17-dynamic-form-provider-v1`) —
 * so a refusal keyed on it would reject the project's own convention.
 * Attribution no longer depends on it either, the stamp having taken
 * that job over.
 */
export function guardRunBranch(
  planStub: string | null,
  branch: string,
  args: readonly string[],
): boolean {
  if (args.includes('--any-branch')) {
    console.warn(`\n⚠️  --any-branch: running on \`${branch}\` without the branch check.`);
    return true;
  }

  if (DEFAULT_BRANCHES.includes(branch)) {
    const name = planStub ?? 'this-plan';
    console.error(`\n❌ Refusing to run a plan on \`${branch}\`.`);
    console.error('   A plan run needs its own branch: that is what gives it a PR to');
    console.error('   review, and what lets the wrap-up\'s CI stage have something to');
    console.error('   wait on. Run on main and both are silently skipped.');
    console.error(`\n   git checkout -b feat/${name}`);
    console.error('\n   Pass --any-branch to run here anyway.');
    return false;
  }

  if (planStub !== null && !branch.includes('/')) {
    console.warn(`\n⚠️  Branch \`${branch}\` carries no \`<type>/\` prefix.`);
    console.warn('   The run proceeds; the convention is `feat/<plan-stub>`.');
  }
  return true;
}

/**
 * Assembles the prompt the end-of-run wrap-up session is given.
 *
 * Its FIRST LINE is a classifier key: `effort/classify.ts` buckets a
 * session whose prompt begins with it as `wrap-up`. So the plan is
 * APPENDED below the instructions and never placed above them, and the
 * stamp {@link withStamp} adds lands after the plan.
 *
 * The plan goes in WHOLE whatever injection mode the run's task
 * sessions were dispatched under, which is why this takes the plan and
 * no mode: there is no mode to get wrong. `full` renders the plan
 * document byte for byte (`plan/inject.ts`), so what is appended here
 * is the `full` rendering. The session titles the PR after the plan,
 * looks for its issue reference there and summarises the work of every
 * stage, and a `stage` or `task` rendering holds one stage, or one
 * task line.
 */
export function buildWrapUpPrompt(branch: string, planContent: string): string {
  return [
    '* Read `@progress.txt` in full.',
    '* If there\'s anything worth keeping, grab what\'s generally relevant from `@progress.txt` and include it in the `context/` page that owns its subject (repo-root `context/` for tree-wide law, `packages/<pkg>/context/` for one package\'s), `@README.md`, `@CONTRIBUTING.md` or a pertinent skill under `.claude/skills/`. The root `@AGENTS.md` is a capped map read into every turn of every session: point at the page from there if a new one is needed, never inline the finding itself.',
    '* Promote a finding ONLY when all three hold, and delete or keep it rather than promoting it when any one fails. It is PROJECT-SPECIFIC — a fact about THIS tree (its layout, its gates, its conventions, what a command here actually answers) and not a general technique, which belongs in a skill and not in this repo\'s docs. It is NOT ALREADY COVERED by a skill under `.claude/skills/` — read the skill that matches the finding\'s subject before writing anything, and extend that skill in place rather than restating it in a second document. And it NAMES WHAT IT REPLACES — the sentence, bullet or table row it supersedes, deleted in the SAME edit — or, when it replaces nothing, says so. A promotion landing beside the claim it should have replaced leaves two authorities on one subject, and nothing here compares two documents, so the stale one is never reported again.',
    '* If a learn/learn-eval skill is available in this session, invoke it now so reusable patterns from this run are persisted as skills.',
    '* If it\'s present, extract the issue reference from the plan below (e.g. "#42") to be used in the PR title.',
    `* If the reference is not present on the plan check if the branch name (${branch}) carries one (e.g. feat/42-slug).`,
    '* Use the plan title as the PR title, include the issue reference if you found it, e.g. "Implement user authentication (#42)".',
    '* Create a concise yet descriptive PR description that summarizes the overall work done based on the completed plan and progress notes.',
    '* BEFORE pushing, bring the branch up to date with the base: `git fetch origin main` then `git merge origin/main`. A branch that conflicts with main gets NO CI run at all — GitHub cannot build `refs/pull/<n>/merge` for it — so a conflicted PR is a plan reported finished whose code was never once checked. Resolving here, where the plan\'s context is still loaded, is the cheapest place it will ever be.',
    '* Resolve MECHANICAL conflicts yourself and do not stop for them: dependency version bumps (take the base\'s version unless this branch deliberately pinned it, and say which in the commit), lockfiles, generated artifacts, and complementary additions where both sides appended different material to the same file (keep BOTH). Stop only for a genuine semantic conflict — two sides changing the same behaviour incompatibly. In that case commit nothing, leave the branch as it is, and report the conflicting paths and both sides\' intent, so a human decides.',
    '* If the merge touched `bun.lock` or any `package.json`, run `bun install --frozen-lockfile` and require it to pass BEFORE pushing. It is the one-second local reproduction of the CI install step, and it catches a lockfile that no longer matches the merged manifests — the failure mode where every CI job dies at its first step and nothing downstream runs. When it fails, do NOT hand-edit the lockfile: restore the base\'s copy (`git checkout origin/main -- bun.lock`), run a plain `bun install` so this branch\'s own dependencies are re-added, and confirm the frozen run then passes.',
    `* Commit these changes and push them to the CURRENT branch (${branch}). Never create a branch here: the work under review is this branch's, and a second branch splits one plan across two reviews.`,
    '* This step is IDEMPOTENT because a plan\'s own close-out may already have opened the PR. Read the state first with `gh pr list --head <branch> --state open --json number`: when it names a PR, push to it and update its body with `gh pr edit` so the description covers the promotions this session just committed; only create one with `gh pr create` when that list is empty. A `gh pr create` failure saying the PR already exists is the expected shape of that race, never a reason to open a second PR from a new branch.',
    '* Do not include Claude attribution in the commit or PR message.',
    '',
    'The plan this run executed follows, in full.',
    '',
    planContent,
  ].join('\n');
}

/** Runs the wrap-up session over the plan the run was started on. */
async function preserveProgress(planContent: string): Promise<void> {
  const prompt = buildWrapUpPrompt(getCurrentBranch(), planContent);
  const exitCode = await runClaude(withStamp(prompt));
  if (exitCode !== 0) {
    console.error(`\n❌ Failed to preserve progress (exit ${exitCode}). Please try again.`);
  } else {
    console.log('\n✅ Progress preserved; PR opened or updated on this branch.');
  }
}

/** How long to keep polling a PR's checks before giving up on them. */
const DEFAULT_CI_TIMEOUT_MIN = 20;

/** Seconds between polls. CI here settles in 2-5 minutes. */
const CI_POLL_INTERVAL_MS = 20_000;

/** Repair sessions spent on a red or conflicting PR before escalating. */
const DEFAULT_CI_ATTEMPTS = 2;

/**
 * Runs one Claude session to repair a PR that CI has rejected.
 *
 * The session is told what failed and where, and explicitly told not to
 * open a second PR — the branch already has one, and a new branch would
 * split a single plan across two reviews.
 */
async function repairPullRequest(
  prNumber: number,
  branch: string,
  reason: string,
  detail: string,
): Promise<number> {
  const prompt = [
    `The pull request for branch \`${branch}\` (#${prNumber}) is not mergeable: ${reason}`,
    '',
    detail,
    '',
    '* Diagnose the ACTUAL cause before changing anything. For a failing GitHub Actions job, read its log: `gh run view <run-id> --log-failed`, or `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs` while other jobs in the run are still going. Identify which STEP failed — a job that dies at `Install dependencies` says nothing about the tests, and the fix is not in the test files.',
    '* A `lockfile had changes, but lockfile is frozen` failure means `bun.lock` no longer matches the manifests. Restore the base copy with `git checkout origin/main -- bun.lock`, run a plain `bun install` to re-add this branch\'s own dependencies, and verify with `bun install --frozen-lockfile`. Never hand-edit the lockfile.',
    '* Reproduce locally before pushing a fix, and re-run the affected gate (`bun run lint:all`, `bun run check-types:all`, `bun run test:all`) so the push is not a guess.',
    '* A test that fails under the full suite and passes when run alone is the known parallel-load flake, not a regression. Re-run the file alone to establish which it is, and if it is the flake, say so and change nothing.',
    `* Commit the fix and push to the CURRENT branch (${branch}). Do NOT create a branch and do NOT open a second PR — #${prNumber} already exists and will pick the push up.`,
    '* If the cause is a genuine semantic conflict or a real defect you cannot fix without a product decision, change nothing, and report what you found and what the options are.',
    '* Do not include Claude attribution in the commit message.',
  ].join('\n');

  return runClaude(withStamp(prompt));
}

/**
 * The wrap-up's last gate: a PR is not done until CI has spoken about it.
 *
 * Polls the PR's checks, and spends up to `maxAttempts` repair sessions on
 * a red or conflicting result before escalating to the operator. Skips
 * itself cleanly when `gh` is unusable, so the loop still works offline.
 */
async function verifyPullRequest(timeoutMs: number, maxAttempts: number): Promise<void> {
  const branch = getCurrentBranch();

  if (!isGhUsable()) {
    console.warn('\n⚠️  `gh` is not available or not authenticated — skipping the CI check.');
    console.warn('   The PR has been pushed but nothing here confirms CI agreed with it.');
    return;
  }

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const prNumber = findOpenPullRequest(branch);
    if (prNumber === null) {
      console.warn(`\n⚠️  No open PR found for ${branch}. Nothing to verify.`);
      return;
    }

    console.log(`\n⏳ Waiting for CI on PR #${prNumber} (up to ${Math.round(timeoutMs / 60000)} min)...`);

    const result = await waitForChecks({
      probe: () => Promise.resolve(probeChecks(prNumber)),
      timeoutMs,
      intervalMs: CI_POLL_INTERVAL_MS,
      onPoll: (rows, verdict, elapsedMs) => {
        const secs = Math.round(elapsedMs / 1000);
        console.log(`   [${secs}s] ${verdict} — ${rows.length} check(s)`);
      },
    });

    if (result.verdict === 'green') {
      console.log(`\n✅ CI green on PR #${prNumber}:`);
      console.log(formatRows(result.rows));
      return;
    }

    if (result.verdict === 'timeout') {
      console.warn(`\n⚠️  CI still running after ${Math.round(result.elapsedMs / 1000)}s. Not waiting further.`);
      console.warn(formatRows(result.rows));
      console.warn(`   Check it yourself: gh pr checks ${prNumber}`);
      return;
    }

    if (attempt === maxAttempts) break;

    // `none` and `red` both get a repair session, with different framing:
    // no checks at all is almost always a conflict, since GitHub cannot
    // build a merge ref for a PR that does not merge cleanly.
    const merge = readMergeState(prNumber);
    if (result.verdict === 'none') {
      if (merge?.state === 'MERGED') {
        console.log(`\n✅ PR #${prNumber} is already merged.`);
        return;
      }
      if (merge !== null && merge.mergeStateStatus !== 'DIRTY') {
        console.warn(`\n⚠️  PR #${prNumber} reports no checks and is not conflicting`);
        console.warn(`   (mergeable=${merge.mergeable} state=${merge.mergeStateStatus}).`);
        console.warn('   Most likely no workflow matches the changed paths. Nothing to repair.');
        return;
      }
      console.warn(`\n❌ PR #${prNumber} has no checks — it does not merge cleanly, so GitHub scheduled no run.`);
      const exitCode = await repairPullRequest(
        prNumber,
        branch,
        'it conflicts with the base branch, so GitHub scheduled no CI run at all.',
        'Merge `origin/main` into this branch and resolve the conflicts, then push. Mechanical conflicts (versions, lockfiles, complementary additions) are yours to resolve; a genuine semantic conflict is not.',
      );
      if (exitCode !== 0) {
        console.error(`\n❌ Conflict-repair session failed (exit ${exitCode}).`);
        return;
      }
      continue;
    }

    console.warn(`\n❌ CI red on PR #${prNumber}:`);
    console.warn(formatRows(result.rows));
    const failed = failingRows(result.rows);
    const exitCode = await repairPullRequest(
      prNumber,
      branch,
      'its CI checks failed.',
      ['The failing checks are:', formatRows(failed)].join('\n'),
    );
    if (exitCode !== 0) {
      console.error(`\n❌ CI-repair session failed (exit ${exitCode}).`);
      return;
    }
  }

  console.error(`\n❌ CI still not green after ${maxAttempts} repair attempt(s) on ${branch}.`);
  console.error('   Stopping rather than looping. Read the failing jobs and decide.');
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit?.slice(flag.length + 1);
}

/** The flag naming how much of the plan each task session is handed. */
const INJECT_FLAG = '--inject';

/**
 * The raw `--inject` value, for `resolveConfig` to validate: undefined
 * without the flag, and the empty string for a bare `--inject`.
 *
 * A bare flag is an empty value rather than no flag, so it is refused.
 * Read as absent, it would dispatch every task under the config's mode
 * while the operator believed they had named one.
 */
function injectFlagValue(args: readonly string[]): string | undefined {
  return args.includes(INJECT_FLAG)
    ? ''
    : argValue(args, INJECT_FLAG);
}

/**
 * Resolves the settings a run starts on: `--inject=` over
 * `.rafa/config.yaml` over the defaults, as `config.ts` ranks them.
 *
 * `--inject` is the one flag. `store` resolves from the file and the
 * default and the loop acts on nothing it says, but the file is judged
 * whole, so an unusable `store:` refuses the run as an unusable
 * `plan.inject:` does.
 *
 * Throws the {@link ConfigError} `loadConfig` throws, naming every
 * problem. A warning per unknown key goes to `warn`, `console.warn`
 * when none is given.
 */
export function loadRunConfig(
  repoRoot: string,
  args: readonly string[],
  warn?: (message: string) => void,
): ResolvedConfig {
  return loadConfig(repoRoot, { inject: injectFlagValue(args) }, warn);
}

/** Where the injection mode came from, as the operator log names it. */
function injectSourceLabel(source: ConfigSource, configPath: string | null): string {
  if (source === 'cli') return INJECT_FLAG;
  if (source === 'file') return configPath ?? 'the config file';
  return 'the default';
}

/**
 * Names every part of the plan `parsePlan` did not read as written, and
 * answers them. Called once, at start.
 *
 * Nothing here stops a run: the parser never throws, and an issue is a
 * warning. It is printed because two of the reasons change what the
 * loop does and nothing else says so. A task line inside a closed
 * `rafa:*` block is block body and is never dispatched, so a block
 * missing its closing fence, closed instead by a later fence, takes
 * every task between the two out of the run. And every line
 * after a block never closed is read by the model as that block's
 * body, so a `stage` or `task` rendering of a task there falls back to
 * `full`.
 */
export function announcePlanIssues(planContent: string): readonly PlanIssue[] {
  const { issues } = parsePlan(planContent);
  if (issues.length === 0) return issues;

  console.warn(`\n⚠️  The plan holds ${issues.length} part(s) the loop does not read as written:`);
  for (const issue of issues) console.warn(`   line ${issue.line}: ${issue.text}`);
  return issues;
}

/** How one git invocation is made on a finished task's behalf. */
export type TaskCommitRunner = (options: CommitOptions) => CommitAttempt;

/** What {@link commitFinishedTask} needs to commit and record one task. */
export interface FinishedTaskOptions {
  /** Tracker whose line is marked once git has answered. */
  trackerPath: string;
  /** The task whose session just returned 0. */
  taskInfo: TaskInfo;
  /** Directory git stages and commits in — the repo root. */
  repoRoot: string;
  /** Commit seam. Defaults to the real helper. */
  commit?: TaskCommitRunner;
}

/** The flag a task session is spawned with to run under the loop's id. */
export const SESSION_ID_FLAG = '--session-id';

/**
 * How one task's Claude session is spawned: `prompt` on stdin, the
 * `flags` its declaration resolved to, and `sessionId` as its id. It
 * answers the exit code together with everything the session wrote to
 * stdout.
 */
export type TaskSessionRunner = (
  prompt: string,
  flags: readonly string[],
  sessionId: string,
) => Promise<CapturedSession>;

/**
 * The loop's task session runner: the CLI through `runClaudeCaptured`,
 * run under the id the dispatch picked.
 *
 * The id goes AHEAD of the declaration's flags. `--tools` is variadic
 * and is the last flag a declaration resolves to (`utils/claude.ts`), so
 * a `--session-id` placed after it would be read as a tool name.
 *
 * The loop picks the id rather than reading it back, because nothing
 * would tell it: under `claude -p` stdout is the session's final message
 * and holds no id. Measured on Claude Code 2.1.268, `claude -p
 * --session-id <uuid>` exited 0, printed only its reply and wrote its
 * log as `<uuid>.jsonl`, the basename `effort collect` keys a session
 * row by (`effort/session-log.ts`). So each row a task's report is
 * stored as joins the session row of the session that wrote it.
 */
export function runTaskSession(
  prompt: string,
  flags: readonly string[],
  sessionId: string,
  spawn?: CapturingSpawner,
): Promise<CapturedSession> {
  return runClaudeCaptured(prompt, [SESSION_ID_FLAG, sessionId, ...flags], spawn);
}

/** What {@link dispatchTask} needs to run one task. */
export interface TaskDispatchOptions {
  /** The task the tracker just handed the loop, declaration and all. */
  taskInfo: TaskInfo;
  /** `PROMPT.md`, read once before the loop. */
  promptContent: string;
  /**
   * The plan file, read once before the loop. The session is handed the
   * share of it {@link TaskDispatchOptions.inject} names.
   */
  planContent: string;
  /**
   * How much of the plan the session is handed. Required rather than
   * defaulted: a default here would be a second one beside
   * `CONFIG_DEFAULTS`, free to disagree with it.
   */
  inject: InjectMode;
  /** Session seam. Defaults to {@link runTaskSession}, the real CLI. */
  run?: TaskSessionRunner;
  /** Where the session's id comes from. Defaults to `randomUUID`. */
  newSessionId?: () => string;
}

/** What one dispatched task actually ran as. */
export interface TaskDispatch {
  /** The task sentence, with any declaration block taken off. */
  taskText: string;
  /** The prompt the session was given, on stdin. */
  prompt: string;
  /** The share of the plan the prompt carries, and why when it fell back. */
  injection: PlanInjection;
  /** Flags the declaration resolved to. Empty without one. */
  flags: readonly string[];
  /** What the block declared, or null when there was none. */
  declaration: TaskDeclaration | null;
  /** The id the session ran under, which also names its log. */
  sessionId: string;
  /** The session's exit code. */
  exitCode: number;
  /** Everything the session wrote to stdout, its report included. */
  output: string;
}

/**
 * Assembles the prompt one task's session is given.
 *
 * `taskText` is the sentence a declaration has already been taken off,
 * and that stripping is the whole reason this is a function rather
 * than three lines inside the loop. The block is an instruction to the
 * LOOP about how to spawn, never to the session about what to build:
 * a session handed `{agent=doc-updater effort=low}` reads it as part
 * of the task, so the routing would be described to the agent instead
 * of applied to it — and the block would then travel on into every
 * artifact that quotes the task back, the plan's own close-out
 * included.
 *
 * `planText` is the share of the plan the run's injection mode rendered
 * (`plan/inject.ts`). Under `full` it is the plan file byte for byte,
 * which makes the prompt the one the loop built before modes existed.
 *
 * The `Your scoped task is: ` prefix is what `effort/classify.ts`
 * buckets a session log by. It is asserted against this file's source
 * by that module's own drift guard, so it must stay spelled here.
 */
export function buildTaskPrompt(
  taskText: string,
  promptContent: string,
  planText: string,
): string {
  return [
    `Your scoped task is: ${taskText}`,
    'Consider tasks listed above this one in the plan checklist as completed. Do not re-evaluate or re-do them. Focus only on the scoped task.',
    '',
    promptContent,
    planText,
  ].join('\n');
}

/**
 * Runs one task's session, routed by whatever its own line declared.
 *
 * Everything a declaration changes happens here: the block comes off
 * the text before the prompt is built, and the flags it resolved to go
 * to the spawn. A task carrying no block resolves to no flags at all,
 * so its session is spawned with the base arguments and its session id
 * and nothing else, the arguments every task session shares. That is
 * the compatibility promise, and it is kept by the resolver rather than
 * by a branch here. Both halves are driven through the real `claudeArgs`
 * in `tests/declaration-dispatch.test.ts`, which is the only place the
 * flags a block resolved to are read off an argument list rather
 * than off this function's own record.
 *
 * Each session runs under a fresh id, `randomUUID` unless
 * `newSessionId` replaces it, and the record carries that id beside
 * everything the session wrote to stdout. Nothing here reads the report
 * in that output: what became of the task is not known until its commit
 * has answered, and the loop stores the report under that outcome.
 *
 * The routing is announced because it is otherwise invisible. A
 * session dispatched under an agent looks exactly like one dispatched
 * at the loop's defaults in the operator's terminal, and a key whose
 * value did not parse deliberately falls back to those defaults rather
 * than stalling the plan on a CLI that refuses `--effort medum`. So
 * each dropped token is named as well: without that line a typo costs
 * a task its routing and nothing anywhere says so.
 *
 * A `rafa:*` block has no strip here, and needs none: `findNextTask`
 * never answers a task line inside a closed one, so the text this
 * announces and injects can carry no block's body.
 *
 * The plan the prompt carries is rendered here in the mode the caller
 * names. A `stage` or `task` rendering that cannot find the task at its
 * line hands the session the whole plan instead, and that is warned
 * about, because the prompt is then several times the size the run
 * asked for and nothing else would show it.
 */
export async function dispatchTask(
  options: TaskDispatchOptions,
): Promise<TaskDispatch> {
  const { taskInfo } = options;
  const run = options.run ?? runTaskSession;

  const { text: taskText, declaration } = parseTaskDeclaration(taskInfo.task);
  const { args: flags, suppressed } = resolveDeclarationFlags(declaration);

  if (taskInfo.status === 'blocked') {
    console.log(`\n⚠️  Resuming blocked task: ${taskText}`);
  } else {
    console.log(`\n🔄 Executing task: ${taskText}`);
  }

  if (flags.length > 0) {
    const note = suppressed.length === 0
      ? ''
      : ` (${suppressed.join(', ')} left to the agent)`;
    console.log(`   Routed as: ${flags.join(' ')}${note}`);
  }

  for (const issue of declaration?.issues ?? []) {
    console.warn(`   Declaration: ignoring ${issue.reason} \`${issue.text}\`.`);
  }

  const injection = renderInjection({
    mode: options.inject,
    plan: options.planContent,
    task: taskInfo,
  });
  if (injection.fallback !== null) {
    console.warn(`   Injection: \`${injection.requested}\` not rendered: ${injection.fallback.text}.`);
  }

  const prompt = withStamp(buildTaskPrompt(
    taskText,
    options.promptContent,
    injection.text,
  ));

  const sessionId = (options.newSessionId ?? randomUUID)();
  const session = await run(prompt, flags, sessionId);

  return {
    taskText,
    prompt,
    flags,
    declaration,
    injection,
    sessionId,
    exitCode: session.exitCode,
    output: session.stdout,
  };
}

/** Indents every line, so a multi-line git message reads as one block. */
function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n');
}

/**
 * Stages and commits one finished task, then marks its tracker line.
 *
 * The commit runs BEFORE the mark because the mark depends on it:
 * `updateTrackerLine` turns `- [ ]` into `- [x]` and has no way back, so a
 * tick written first could not be retracted by a commit that then failed.
 *
 * `nothing-to-commit` ticks the box exactly as `committed` does. A task
 * whose whole output is a `.plans/` edit, a `progress.txt` append or a
 * `/tmp` capture changes no tracked file and has still done what it was
 * asked; blocking it would stall a plan on its most ordinary shape. See
 * `utils/commit.ts` for the rest of that reasoning.
 *
 * The declaration comes off the text first. A commit subject is derived
 * from the task sentence, so a block left on it would reach the git
 * history — where nothing here can ever go back and take it out. A
 * `rafa:*` block needs no strip here: `findNextTask` never answers a
 * task line inside a closed one, so none reaches `taskInfo`.
 *
 * A failure blocks the task, and the caller stops the loop rather than
 * moving on. It has to: `findNextTask` resumes a blocked task FIRST, so
 * carrying on would re-dispatch this same task immediately and forever,
 * and a rejected hook or a broken index is not something the next task
 * can fix. The work is left STAGED — git does not unstage what a
 * pre-commit hook refused — so the next run sees the tree as the session
 * left it.
 */
export function commitFinishedTask(options: FinishedTaskOptions): CommitAttempt {
  const { taskInfo, trackerPath } = options;
  const commit = options.commit ?? commitTaskWork;
  const taskText = stripTaskDeclaration(taskInfo.task);

  const attempt = commit({ taskText, cwd: options.repoRoot });

  if (attempt.outcome === 'failed') {
    updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
    console.error(`\n❌ Commit refused at the ${attempt.failedStep} step (exit ${attempt.exitCode}).`);
    if (attempt.message.length > 0) console.error(indentBlock(attempt.message));
    console.error('   The work is staged and still in the tree. Task marked as blocked.');
    console.error('   Fix the cause and run again to retry this task.');
    return attempt;
  }

  updateTrackerLine(trackerPath, taskInfo.lineNum, 'done');
  console.log(`✅ Task done: ${taskText}`);
  if (attempt.outcome === 'committed') {
    const sha = attempt.sha?.slice(0, 7) ?? 'unknown sha';
    console.log(`   Committed ${sha} ${attempt.subject}`);
  } else {
    console.log('   Nothing to commit: the task changed no tracked file.');
  }

  return attempt;
}

/** An error's message, or the thrown value itself when it is no error. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Renders `progress.txt` from the stored findings ahead of a dispatch,
 * and answers whether it could.
 *
 * Called before EVERY session that reads the file, the wrap-up's
 * included, so each is handed what the store held once the task before
 * it was recorded. The file is replaced whole, and a store holding no
 * finding for this plan renders it empty, which blanks a `progress.txt`
 * written by hand.
 *
 * A store that cannot be read answers false with the file left as it
 * was (`utils/progress.ts` reads before it writes), and the caller stops
 * the run before the dispatch: nothing has been spent yet, and every
 * later dispatch would meet the same store.
 */
export function renderProgressForDispatch(repoRoot: string, planStub: string | null): boolean {
  try {
    const render = writeProgress(repoRoot, planStub);
    const left = render.oversized + render.omitted;
    if (left > 0) {
      console.warn(`📝 progress.txt holds ${render.rendered} finding(s); ${left} more did not fit its ${PROGRESS_CAP_BYTES} bytes.`);
    }
    return true;
  } catch (error) {
    console.error(`\n❌ progress.txt could not be rendered from the findings store: ${messageOf(error)}`);
    console.error('   Nothing was dispatched. Make the store readable, then run again.');
    return false;
  }
}

/** What {@link storeTaskReport} needs to store one session's report. */
export interface TaskReportStoreOptions {
  /** The repo root the store lives under. */
  readonly repoRoot: string;
  /** The plan the run is executing, or null when its file name gives none. */
  readonly planStub: string | null;
  /** The dispatch whose session wrote the report. */
  readonly dispatch: Pick<TaskDispatch, 'sessionId' | 'taskText' | 'output'>;
  /** What the loop made of the task. */
  readonly outcome: FindingOutcome;
}

/**
 * Stores what one task session reported under the loop's outcome for its
 * task, tells the operator what was stored, and answers whether the store
 * took it.
 *
 * Every row carries the sentence the dispatch quoted, declaration off, and
 * the id the session ran under, so it joins that session's log. An output
 * with no report the loop can read is stored as one telemetry row, and a
 * warning says why (`report/record.ts`).
 *
 * A write the store refuses answers false, and the caller stops the run
 * rather than dispatching tasks whose reports would meet the same store.
 * The report is not gone with the row: the session wrote it to the
 * operator's terminal as it ran.
 */
export function storeTaskReport(options: TaskReportStoreOptions): boolean {
  const { dispatch } = options;
  try {
    const record = recordTaskReport(options.repoRoot, {
      dispatch: {
        sessionId: dispatch.sessionId,
        planStub: options.planStub,
        taskLine: dispatch.taskText,
      },
      outcome: options.outcome,
      output: dispatch.output,
    });
    const { notes, warnings } = describeTaskReportRecord(record);
    for (const note of notes) console.log(`   ${note}`);
    for (const warning of warnings) console.warn(`   ${warning}`);
    return true;
  } catch (error) {
    console.error(`\n❌ The report of session ${dispatch.sessionId} was not stored: ${messageOf(error)}`);
    console.error('   The session printed it above as it ran.');
    return false;
  }
}

export default async function start(args: string[]): Promise<void> {
  const repoRoot = getRepoRoot();

  // Before the deferral: a run queued for 23:00 that only meets a refused
  // config then has lost the night, where refusing now costs one command.
  let runConfig: ResolvedConfig;
  try {
    runConfig = loadRunConfig(repoRoot, args);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error('❌ Refusing to start on this configuration:');
    for (const problem of error.problems) console.error(`   ${problem}`);
    process.exit(1);
  }
  const injectMode = runConfig.config.inject;

  const startAt = argValue(args, '--start-at');
  if (startAt) await deferUntil(startAt);

  const ciWait = !args.includes('--no-ci-wait');
  const ciTimeoutMin = Number(argValue(args, '--ci-timeout') ?? DEFAULT_CI_TIMEOUT_MIN);
  const ciAttempts = Number(argValue(args, '--ci-attempts') ?? DEFAULT_CI_ATTEMPTS);

  // Default plan: .plans/PLAN.md (the untracked plans directory `ralph plan`
  // writes to), falling back to a root PLAN.md for hand-written plans.
  const planArg = argValue(args, '--plan');
  const defaultPlanPath = fs.existsSync(path.join(repoRoot, '.plans', 'PLAN.md'))
    ? path.join(repoRoot, '.plans', 'PLAN.md')
    : path.join(repoRoot, 'PLAN.md');
  const planPath = planArg
    ? path.resolve(repoRoot, planArg)
    : defaultPlanPath;

  const rootPromptPath = path.join(repoRoot, 'PROMPT.md');
  const promptPath = fs.existsSync(rootPromptPath)
    ? rootPromptPath
    : path.join(__dirname, 'PROMPT.md');

  const trackerPath = trackerPathFor(planPath);

  if (!fs.existsSync(planPath)) {
    console.error(`❌ Plan file not found: ${planPath}`);
    process.exit(1);
  }

  const planStub = planStubFromPath(planPath);
  if (!guardRunBranch(planStub, getCurrentBranch(), args)) process.exit(1);
  setActivePlanStub(planStub);

  const planContent = fs.readFileSync(planPath, 'utf8');
  const promptContent = fs.readFileSync(promptPath, 'utf8');

  const injectSource = injectSourceLabel(runConfig.sources.inject, runConfig.path);
  console.log(`🧭 Task sessions are handed the plan as \`${injectMode}\` (${injectSource}); the wrap-up is handed all of it.`);
  announcePlanIssues(planContent);

  // Initialize tracker only if it doesn't exist
  if (!fs.existsSync(trackerPath)) {
    console.log(`📋 Creating new plan tracker at ${path.basename(trackerPath)}...`);
    fs.copyFileSync(planPath, trackerPath);
  } else {
    console.log(`📋 Resuming from existing ${path.basename(trackerPath)}...`);
  }

  // SIGINT: flag and finish cleanup (mark blocked + exit) after the await returns.
  process.on('SIGINT', () => {
    interrupted = true;
  });

  while (true) {
    if (interrupted) break;

    const trackerContent = fs.readFileSync(trackerPath, 'utf8');
    const taskInfo = findNextTask(trackerContent);

    // Before the session it is for, whichever it is: a task or the wrap-up.
    if (!renderProgressForDispatch(repoRoot, planStub)) return;

    if (!taskInfo) {
      console.log('\n✅ All tasks completed!');
      console.log('🧹 Wrap-up session starting: promote progress.txt findings, sync with main, then commit, push and open the PR.');
      console.log('   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.');
      await preserveProgress(planContent);
      if (ciWait) {
        await verifyPullRequest(
          Math.max(1, ciTimeoutMin) * 60_000,
          Math.max(0, ciAttempts),
        );
      }
      break;
    }

    const dispatch = await dispatchTask({
      taskInfo,
      promptContent,
      planContent,
      inject: injectMode,
    });
    const { exitCode } = dispatch;

    // Stored once the task's fate is known, and never before: the
    // outcome goes on every row the report is stored as.
    const storeReport = (outcome: FindingOutcome): boolean => storeTaskReport({
      repoRoot,
      planStub,
      dispatch,
      outcome,
    });

    if (interrupted) {
      updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
      console.log('\n⚠️  Interrupted. Task marked as blocked. Run again to resume.');
      storeReport('blocked');
      process.exit(0);
    }

    if (exitCode !== 0) {
      updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
      console.error(`\n❌ Task failed (exit ${exitCode}). Marked as blocked. Run again to retry.`);
      storeReport('failed');
      return;
    }

    const attempt = commitFinishedTask({ trackerPath, taskInfo, repoRoot });
    const committed = attempt.outcome !== 'failed';
    const stored = storeReport(committed
      ? 'done'
      : 'blocked');
    if (!committed) return;
    if (!stored) {
      console.error('   Stopping here. The task stays ticked, so the next run starts after it.');
      return;
    }

    const shouldPause = await checkUsage('task');
    if (shouldPause) {
      console.log('\n⚠️  Pausing task loop due to high Claude usage. Run again when usage is lower.');
      break;
    }
  }
}
