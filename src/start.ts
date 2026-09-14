#!/usr/bin/env bun

/**
 * ralph start — the task loop.
 *
 * Walks the plan's tracker checklist one task at a time, delegating each task
 * to a Claude Code session and then staging and committing whatever that
 * session left in the tree (`start/commit.ts`). `[x]` is marked once git has
 * answered; `[BLOCKED]` on a failed or interrupted session, on a commit git
 * refused, and on a task whose own report says `status: blocked` or lists a
 * blocker, its partial work committed first. Each of those stops the run.
 * Re-running resumes: blocked tasks are retried first.
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
 * as written is named to the operator once, at start. `start/run-config.ts`
 * does both.
 *
 * Each task session is spawned under an id the loop picks, with its stdout
 * captured (`start/dispatch.ts`). The exit code alone decides `failed`; a
 * clean exit is `blocked` when git refuses its commit or the `rafa:report`
 * block that output ends with holds the task, and `done` otherwise
 * (`start/commit.ts`). Once the loop knows what became of the task, the
 * report is stored: its status, findings, blockers and out-of-scope bugs,
 * or, with no block the loop could read, one telemetry row saying why
 * (`report/record.ts`). Before every dispatch, the wrap-up's included,
 * `progress.txt` is rendered from the stored findings (`utils/progress.ts`).
 * A store the loop cannot read or write stops the run: before a dispatch,
 * nothing is dispatched; after a task, its commit and its mark stand.
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
 * After the last task the loop runs a wrap-up session (`start/wrap-up.ts`:
 * promote findings, sync with main, commit, push, open or update the PR)
 * and then WAITS on that PR's checks (`start/pr-lifecycle.ts`). A
 * conflicting PR gets no CI run at all, so without this last stage the
 * loop can report a finished plan whose code was never checked once.
 */
import type { ResolvedConfig } from './config.js';
import type { FindingOutcome } from './effort/store/findings.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigError } from './config.js';
import { finishCleanExit } from './start/commit.js';
import {
  dispatchTask,
  renderProgressForDispatch,
  storeTaskReport,
} from './start/dispatch.js';
import {
  DEFAULT_CI_ATTEMPTS,
  DEFAULT_CI_TIMEOUT_MIN,
  verifyPullRequest,
} from './start/pr-lifecycle.js';
import {
  announcePlanIssues,
  argValue,
  injectSourceLabel,
  loadRunConfig,
} from './start/run-config.js';
import { setActivePlanStub } from './start/stamp.js';
import { preserveProgress } from './start/wrap-up.js';
import { checkUsage } from './utils/claude.js';
import { getCurrentBranch, getRepoRoot } from './utils/git.js';
import { planStubFromPath } from './utils/plan-stamp.js';
import { deferUntil } from './utils/schedule.js';
import { findNextTask, trackerPathFor, updateTrackerLine } from './utils/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let interrupted = false;

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
      repoRoot,
      home: homedir(),
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

    const finished = finishCleanExit({
      trackerPath,
      taskInfo,
      repoRoot,
      output: dispatch.output,
    });
    const stored = storeReport(finished.outcome);
    if (finished.outcome !== 'done') return;
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
