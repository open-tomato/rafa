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
 * the commit message all see the task sentence alone.
 *
 * Between tasks the loop also asks `utils/progress.ts` whether `progress.txt`
 * has grown past what the next task should have to read, and spends a
 * compaction session on it when it has. That session belongs to no task: it
 * writes no tracker line and makes no commit.
 *
 *   bun tools/ralph/ralph.ts start [--plan=PLAN-foo.md] [--start-at=HH:MM]
 *
 * --plan        plan file to execute (default: PLAN.md at the repo root). The
 *               tracker is derived per plan (PLAN-foo.md → PLAN_TRACKER-foo.md)
 *               so several plans can coexist.
 * --start-at    defer the run until a local time of day (e.g. 23:00) — queue
 *               off-hours runs without cron.
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
import type { CommitAttempt, CommitOptions } from './utils/commit.js';
import type { TaskDeclaration } from './utils/declaration.js';
import type {
  CompactionDecision,
  CompactionThresholds,
} from './utils/progress.js';
import type { TaskInfo } from './utils/tracker.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { runClaude, checkUsage } from './utils/claude.js';
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
import {
  isCompactionDue,
  progressFilePath,
  readProgressSizeBytes,
} from './utils/progress.js';
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

async function preserveProgress(): Promise<void> {
  const branch = getCurrentBranch();

  const prompt = [
    '* Read `@progress.txt` in full.',
    '* If there\'s anything worth keeping, grab what\'s generally relevant from `@progress.txt` and include it in the `context/` page that owns its subject (repo-root `context/` for tree-wide law, `packages/<pkg>/context/` for one package\'s), `@README.md`, `@CONTRIBUTING.md` or a pertinent skill under `.claude/skills/`. The root `@AGENTS.md` is a capped map read into every turn of every session: point at the page from there if a new one is needed, never inline the finding itself.',
    '* Promote a finding ONLY when all three hold, and delete or keep it rather than promoting it when any one fails. It is PROJECT-SPECIFIC — a fact about THIS tree (its layout, its gates, its conventions, what a command here actually answers) and not a general technique, which belongs in a skill and not in this repo\'s docs. It is NOT ALREADY COVERED by a skill under `.claude/skills/` — read the skill that matches the finding\'s subject before writing anything, and extend that skill in place rather than restating it in a second document. And it NAMES WHAT IT REPLACES — the sentence, bullet or table row it supersedes, deleted in the SAME edit — or, when it replaces nothing, says so. A promotion landing beside the claim it should have replaced leaves two authorities on one subject, and nothing here compares two documents, so the stale one is never reported again.',
    '* If a learn/learn-eval skill is available in this session, invoke it now so reusable patterns from this run are persisted as skills.',
    '* Then compact `@progress.txt` per `.claude/skills/progress-hygiene/SKILL.md`: drop every finding that was just persisted somewhere durable and anything stale or task-specific; keep only broadly-relevant findings not yet promoted. The file must stay small — future plan generation injects it as context.',
    '* If it\'s present, extract the issue reference from the plan file (e.g. "#42") to be used in the PR title.',
    `* If the reference is not present on the plan check if the branch name (${branch}) carries one (e.g. feat/42-slug).`,
    '* Use the plan title as the PR title, include the issue reference if you found it, e.g. "Implement user authentication (#42)".',
    '* Create a concise yet descriptive PR description that summarizes the overall work done based on the completed plan and progress notes.',
    '* BEFORE pushing, bring the branch up to date with the base: `git fetch origin main` then `git merge origin/main`. A branch that conflicts with main gets NO CI run at all — GitHub cannot build `refs/pull/<n>/merge` for it — so a conflicted PR is a plan reported finished whose code was never once checked. Resolving here, where the plan\'s context is still loaded, is the cheapest place it will ever be.',
    '* Resolve MECHANICAL conflicts yourself and do not stop for them: dependency version bumps (take the base\'s version unless this branch deliberately pinned it, and say which in the commit), lockfiles, generated artifacts, and complementary additions where both sides appended different material to the same file (keep BOTH). Stop only for a genuine semantic conflict — two sides changing the same behaviour incompatibly. In that case commit nothing, leave the branch as it is, and report the conflicting paths and both sides\' intent, so a human decides.',
    '* If the merge touched `bun.lock` or any `package.json`, run `bun install --frozen-lockfile` and require it to pass BEFORE pushing. It is the one-second local reproduction of the CI install step, and it catches a lockfile that no longer matches the merged manifests — the failure mode where every CI job dies at its first step and nothing downstream runs. When it fails, do NOT hand-edit the lockfile: restore the base\'s copy (`git checkout origin/main -- bun.lock`), run a plain `bun install` so this branch\'s own dependencies are re-added, and confirm the frozen run then passes.',
    `* Commit these changes and push them to the CURRENT branch (${branch}). Never create a branch here: the work under review is this branch's, and a second branch splits one plan across two reviews.`,
    '* This step is IDEMPOTENT because a plan\'s own close-out may already have opened the PR. Read the state first with `gh pr list --head <branch> --state open --json number`: when it names a PR, push to it and update its body with `gh pr edit` so the description covers the promotions this session just committed; only create one with `gh pr create` when that list is empty. A `gh pr create` failure saying the PR already exists is the expected shape of that race, never a reason to open a second PR from a new branch.',
    '* Do not include Claude attribution in the commit or PR message.',
  ].join('\n');

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

function argValue(args: string[], flag: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit?.slice(flag.length + 1);
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

/** How one task's Claude session is spawned. */
export type TaskSessionRunner = (
  prompt: string,
  flags: readonly string[],
) => Promise<number>;

/** What {@link dispatchTask} needs to run one task. */
export interface TaskDispatchOptions {
  /** The task the tracker just handed the loop, declaration and all. */
  taskInfo: TaskInfo;
  /** `PROMPT.md`, read once before the loop. */
  promptContent: string;
  /** The plan file, read once before the loop. */
  planContent: string;
  /** Session seam. Defaults to the real CLI. */
  run?: TaskSessionRunner;
}

/** What one dispatched task actually ran as. */
export interface TaskDispatch {
  /** The task sentence, with any declaration block taken off. */
  taskText: string;
  /** The prompt the session was given, on stdin. */
  prompt: string;
  /** Flags the declaration resolved to. Empty without one. */
  flags: readonly string[];
  /** What the block declared, or null when there was none. */
  declaration: TaskDeclaration | null;
  /** The session's exit code. */
  exitCode: number;
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
 * The `Your scoped task is: ` prefix is what `effort/classify.ts`
 * buckets a session log by. It is asserted against this file's source
 * by that module's own drift guard, so it must stay spelled here.
 */
export function buildTaskPrompt(
  taskText: string,
  promptContent: string,
  planContent: string,
): string {
  return [
    `Your scoped task is: ${taskText}`,
    'Consider tasks listed above this one in the plan checklist as completed. Do not re-evaluate or re-do them. Focus only on the scoped task.',
    '',
    promptContent,
    planContent,
  ].join('\n');
}

/**
 * Runs one task's session, routed by whatever its own line declared.
 *
 * Everything a declaration changes happens here: the block comes off
 * the text before the prompt is built, and the flags it resolved to go
 * to the spawn. A task carrying no block resolves to no flags at all,
 * so `runClaude` is called with the empty list it defaults to and the
 * session is byte-for-byte the one the loop spawned before
 * declarations existed. That is the compatibility promise, and it is
 * kept by the resolver rather than by a branch here. Both halves are
 * driven through the real `runClaude` in
 * `tests/declaration-dispatch.test.ts`, which is the only place the
 * flags a block resolved to are read off an argument list rather
 * than off this function's own record.
 *
 * The routing is announced because it is otherwise invisible. A
 * session dispatched under an agent looks exactly like one dispatched
 * at the loop's defaults in the operator's terminal, and a key whose
 * value did not parse deliberately falls back to those defaults rather
 * than stalling the plan on a CLI that refuses `--effort medum`. So
 * each dropped token is named as well: without that line a typo costs
 * a task its routing and nothing anywhere says so.
 */
export async function dispatchTask(
  options: TaskDispatchOptions,
): Promise<TaskDispatch> {
  const { taskInfo } = options;
  const run = options.run ?? runClaude;

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

  const prompt = withStamp(buildTaskPrompt(
    taskText,
    options.promptContent,
    options.planContent,
  ));

  const exitCode = await run(prompt, flags);

  return { taskText, prompt, flags, declaration, exitCode };
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
 * history — where nothing here can ever go back and take it out.
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

/** How a compaction session is spawned. Takes no flags: it is unrouted. */
export type CompactionSessionRunner = (prompt: string) => Promise<number>;

/** What {@link maybeCompactProgress} needs to decide, and to act. */
export interface CompactionOptions {
  /** Repo root. `progress.txt` sits at its top level. */
  repoRoot: string;
  /** Tasks finished since the last compaction, this one included. */
  tasksSinceCompaction: number;
  /** Threshold overrides, merged over the module's own defaults. */
  thresholds?: Partial<CompactionThresholds>;
  /** Size reader seam. Defaults to the real `statSync`. */
  readSizeBytes?: (filePath: string) => number;
  /** Session seam. Defaults to the real CLI. */
  run?: CompactionSessionRunner;
}

/** What one between-tasks compaction decision did. */
export interface CompactionRun {
  /** The decision, carrying the size and counter it was taken on. */
  decision: CompactionDecision;
  /** True when a session was actually spawned. */
  dispatched: boolean;
  /** That session's exit code, or null when none ran. */
  exitCode: number | null;
  /** The file's size after it, or null when none ran. */
  sizeAfterBytes: number | null;
  /** The counter the next task carries in. Zero once one was asked for. */
  tasksSinceCompaction: number;
}

/**
 * Assembles the prompt a mid-run compaction session is given.
 *
 * Its FIRST LINE is a classifier key: `effort/classify.ts` buckets a
 * session log by the prefix its prompt begins with, and `compaction`
 * is one of the shapes there with this file named as its source. A
 * line prepended above it would re-bucket every later compaction as
 * residue while that module's drift guard — a containment check over
 * the whole file — stayed green. Add bullets after line 1, never
 * before it.
 *
 * The session's blast radius is one gitignored file, and that is what
 * makes this safe to run BETWEEN tasks rather than after the last one.
 * `progress.txt` is gitignored, so a session confined to it changes no
 * tracked file, needs no commit, and leaves nothing for the next
 * task's `git add -A` to sweep into a commit whose subject describes
 * something else. The prompt says so explicitly, because the skill it
 * cites describes a promotion ladder that writes to tracked
 * `context/` pages and skills — correct for the end-of-run wrap-up
 * that owns it, wrong here.
 *
 * That bound is also why this asks for DELETION rather than
 * promotion, and why it says to stop instead of over-deleting: the
 * loop cannot verify a session shrank anything, so the only thing
 * standing between an unshrinkable file and a finding thrown away to
 * satisfy a number is the instruction not to.
 */
export function buildCompactionPrompt(decision: CompactionDecision): string {
  const { sizeBytes, reason, thresholds } = decision;

  return [
    '* Compact `@progress.txt` per `.claude/skills/progress-hygiene/SKILL.md`, and change NOTHING else.',
    `* This is a MID-RUN compaction, not the end-of-run one: the plan is unfinished and the next task starts the moment you exit. The loop dispatched it because progress.txt is ${sizeBytes} bytes against a hard cap of ${thresholds.hardCapBytes} (rule: ${reason}). Every task is told to read the whole file before it starts, so every byte left here is paid for again by each task still to come.`,
    '* Edit progress.txt and NO other file. It is gitignored, so this session leaves the working tree clean and the loop makes no commit for it — whereas a promotion written into a tracked file here would be swept into the NEXT task\'s commit, under a subject describing something else entirely. The end-of-run wrap-up owns the promotion ladder; you own the file.',
    '* So DELETE rather than promote, and delete only what is safe to lose: a finding already covered by a skill under `.claude/skills/` or by a `context/` page (OPEN the destination and confirm it before dropping the line), a finding the current code or a later finding contradicts, and anything task-specific that leaked in. Merge near-duplicates into the single most precise phrasing.',
    '* Keep everything else, in its original order and its original one-finding-per-bullet shape. Recency is meaningful — plan generation injects this file and truncates it oldest-first. Do not add a heading, a date, or a summary of what you removed.',
    `* Get under ${thresholds.softCapBytes} bytes if the file honestly allows it. If it does not, stop there rather than deleting a finding that is still true and unpromoted. The loop will ask again after the next task; a finding deleted here is gone for good.`,
  ].join('\n');
}

/**
 * Decides whether `progress.txt` is due a compaction, and runs one.
 *
 * Called between tasks, after the finished task has been committed and
 * ticked. Two things it deliberately does NOT do, both of which the
 * scoped task it implements names. It never touches the tracker: it is
 * handed no tracker path, so a compaction cannot tick, block or shift
 * a line, and a session that fails leaves the finished task's `[x]`
 * exactly as the commit left it. And it never stops the loop — a
 * failed compaction is warned about and stepped over, because
 * `progress.txt` is scratch memory and the next task can still read an
 * uncompacted file, where a blocked task would re-dispatch forever.
 *
 * The counter resets on DISPATCH and not on success, which is what
 * bounds the file the model cannot shrink: a session that ran and
 * removed nothing has still been asked, so the next ask waits for the
 * next completed task. `utils/progress.ts` carries the rest of that
 * reasoning.
 *
 * The size is read twice — once for the decision, once after the
 * session — and both reads go through the same seam. A `statSync`
 * failure that is not simple absence throws, by that module's
 * deliberate choice: a file nobody can read must not pass for a small
 * one and silently suppress every compaction the run needed.
 *
 * `tests/progress-compaction.test.ts` is the integration over this,
 * and it re-drove every leg named here as its own landing check:
 * return before the run when the decision is not due, dispatch on a
 * `due` decision that is not hard-cap, reset the counter to zero on a
 * FAILED session as well as a passing one, keep the counter unchanged
 * when nothing was dispatched, and hand `run` a prompt built from
 * THIS decision rather than a constant. All five redden there. The
 * under-cap case is the control that keeps them honest: it must reach
 * the runner zero times, which no assertion on a returned record can
 * say by itself.
 */
export async function maybeCompactProgress(
  options: CompactionOptions,
): Promise<CompactionRun> {
  const readSize = options.readSizeBytes ?? readProgressSizeBytes;
  const run = options.run ?? ((prompt: string) => runClaude(withStamp(prompt)));
  const filePath = progressFilePath(options.repoRoot);

  const decision = isCompactionDue(
    {
      sizeBytes: readSize(filePath),
      tasksSinceCompaction: options.tasksSinceCompaction,
    },
    options.thresholds ?? {},
  );

  if (!decision.due) {
    return {
      decision,
      dispatched: false,
      exitCode: null,
      sizeAfterBytes: null,
      tasksSinceCompaction: options.tasksSinceCompaction,
    };
  }

  console.log(`\n🧹 progress.txt is ${decision.sizeBytes} bytes (${decision.reason}) — compacting before the next task.`);
  console.log('   One Claude session over that one gitignored file: no tracker line, no commit.');

  const exitCode = await run(buildCompactionPrompt(decision));
  const sizeAfterBytes = readSize(filePath);

  if (exitCode === 0) {
    console.log(`✅ progress.txt compacted: ${decision.sizeBytes} → ${sizeAfterBytes} bytes.`);
  } else {
    console.warn(`\n⚠️  Compaction session failed (exit ${exitCode}); progress.txt is ${sizeAfterBytes} bytes.`);
    console.warn('   Continuing anyway — the file is scratch memory, and the next task can read it as it stands.');
  }

  return {
    decision,
    dispatched: true,
    exitCode,
    sizeAfterBytes,
    tasksSinceCompaction: 0,
  };
}

export default async function start(args: string[]): Promise<void> {
  const repoRoot = getRepoRoot();

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

  // Tasks finished since the last compaction. In memory on purpose: a fresh
  // `ralph start` begins at zero, so a restart cannot dispatch a compaction
  // before it has a task's worth of appended findings to compact.
  let tasksSinceCompaction = 0;

  while (true) {
    if (interrupted) break;

    const trackerContent = fs.readFileSync(trackerPath, 'utf8');
    const taskInfo = findNextTask(trackerContent);

    if (!taskInfo) {
      console.log('\n✅ All tasks completed!');
      console.log('🧹 Wrap-up session starting: promote progress.txt findings, compact it, sync with main, then commit, push and open the PR.');
      console.log('   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.');
      await preserveProgress();
      if (ciWait) {
        await verifyPullRequest(
          Math.max(1, ciTimeoutMin) * 60_000,
          Math.max(0, ciAttempts),
        );
      }
      break;
    }

    const { exitCode } = await dispatchTask({ taskInfo, promptContent, planContent });

    if (interrupted) {
      updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
      console.log('\n⚠️  Interrupted. Task marked as blocked. Run again to resume.');
      process.exit(0);
    }

    if (exitCode !== 0) {
      updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
      console.error(`\n❌ Task failed (exit ${exitCode}). Marked as blocked. Run again to retry.`);
      return;
    }

    const attempt = commitFinishedTask({ trackerPath, taskInfo, repoRoot });
    if (attempt.outcome === 'failed') return;

    // Between tasks, and BEFORE the usage gate: a compaction bounds what
    // every task after this one has to read, so a run that pauses here
    // without taking it hands the whole oversized file to the next run's
    // first task, which starts the counter at zero and cannot compact.
    tasksSinceCompaction += 1;
    const compaction = await maybeCompactProgress({
      repoRoot,
      tasksSinceCompaction,
    });
    tasksSinceCompaction = compaction.tasksSinceCompaction;

    const shouldPause = await checkUsage('task');
    if (shouldPause) {
      console.log('\n⚠️  Pausing task loop due to high Claude usage. Run again when usage is lower.');
      break;
    }
  }
}
