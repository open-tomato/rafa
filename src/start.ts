#!/usr/bin/env bun

/**
 * rafa start — the task loop.
 *
 * Walks the plan's tracker checklist one task at a time, delegating each task
 * to a Claude Code session and then staging and committing whatever that
 * session left in the tree (`start/commit.ts`). `[x]` is marked once git has
 * answered; `[BLOCKED]` on a failed or interrupted session, on a commit git
 * refused, and on a task whose own report says `status: blocked` or lists a
 * blocker, its partial work committed first. A session that ran out of the
 * budget its task declared is marked `[BLOCKED]` with `budget exceeded` as
 * its blocker text (`start/budget.ts`). Each of those stops the run.
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
 * does both. The same resolution names the setting sources every session the
 * run spawns loads, task, wrap-up and CI repair alike: `loop.settingSources`,
 * `project,local` unless a config names others (`utils/claude.ts`).
 *
 * A `--runtime=<path|version>` naming an installed rafa other than the one
 * running sends the whole run there, before anything else is read
 * (`start/runtime.ts`): a version under `~/.rafa/runtime/`, or a path to a
 * `cli.js` or the directory holding it, refused inside the `src/` of the
 * working directory or of the project root. That runtime is run as
 * `start` with the run's other words and waited for, and its exit code is
 * this run's.
 *
 * Once the branch guard lets the run through, and before anything else is
 * printed or checked, the run opens its session (`start/session.ts`): it
 * writes `.rafa/runs/<session-id>.json` under a new id, naming the plan's
 * stub and path, the branch, this process's pid, the start time, the state
 * `running` and no task (`loop/sessions.ts`). A record of the plan refuses
 * the run when it names another branch, whatever its state, or names this
 * branch and still reads `running` or `paused`; a record whose pid is gone
 * reads `stopped`. The record names each task before its dispatch and no
 * task once the wrap-up starts, and the run's end writes `done` after the
 * wrap-up and the CI wait come back and `stopped` on every other way out.
 *
 * At the top of each turn of the loop, before the tracker is read for the
 * next task, the run reads its record and holds while it reads `paused`,
 * as `rafa loop pause` writes it (`start/pause.ts`). So a pause takes
 * effect once the running task is committed, marked, stored and triaged,
 * and marks nothing. While it holds, the record names no task.
 * `rafa loop resume` writes `running`, and the run goes on; a SIGINT ends
 * the hold, and the run.
 *
 * Before the tracker is created and before any session is spawned, the
 * wrap-up's included, the run's preflight checks the configured
 * prerequisites and those of the plan's `PREREQUISITES-<stub>.md`, and
 * stores a row per check under the session's id as its run id
 * (`start/preflight.ts`). A failed required item refuses the run. Each
 * failed optional one becomes a `known-missing:` line that every task
 * prompt carries after its plan text, with one sentence saying such an
 * item is neither a bug to fix nor a credential to patch around.
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
 * After each task's report is stored, and so after its commit and its
 * mark, the run's triage acts on it (`start/triage.ts`): the report's
 * blocker text goes onto the task's tracker line, for that task's next
 * dispatch to read, and each out-of-scope bug is filed, or commented on
 * where its artifact already has an issue. A security bug, or one with no
 * flag, goes only to the private tracker under `.rafa/triage/private/`;
 * every other bug goes through the tracker chain, resolved at most once
 * per run, when a report first lists such a bug. A triage failure is a
 * warning and stops nothing, and no bug is ever dispatched as a task.
 *
 *   bun src/rafa.ts start [--plan=PLAN-foo.md] [--start-at=HH:MM] [--inject=stage]
 *
 * --plan        plan file to execute (default: PLAN.md in plan.dir, else at the
 *               project root; `start/plan-path.ts`). The tracker is derived per
 *               plan (PLAN-foo.md → PLAN_TRACKER-foo.md) so several plans can
 *               coexist.
 * --start-at    defer the run until a local time of day (e.g. 23:00) — queue
 *               off-hours runs without cron.
 * --inject      how much of the plan each task session is handed: full, stage
 *               or task. Outranks `plan.inject` in `.rafa/config.yaml`. The
 *               wrap-up session is handed the whole plan whatever it says.
 * --runtime     the installed rafa the run goes on in: a version under
 *               `~/.rafa/runtime/`, or a path to a `cli.js` or its directory
 *               (`start/runtime.ts`).
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
 *
 * Every line this module, `start/run-config.ts`, `start/runtime.ts`, `start/session.ts`,
 * `start/preflight.ts`, `start/commit.ts`, `start/budget.ts`,
 * `start/triage.ts` and `start/wrap-up.ts` write goes
 * through the active output
 * (`adapters/output/active.ts`): what went to `console.log` through
 * `info`, `console.warn` through `warn` and `console.error` through
 * `error`, each message as it was. Under the dispatcher that is the
 * invocation's output, so json mode reads each as a `log` event.
 *
 * The run is refused by throwing `CommandExit` (`cli/command.ts`) and
 * never by `process.exit`, so the dispatcher writes the terminal event.
 * A line asking for `-d|--detached`, refused before anything else is
 * read (`start/run-config.ts`), a `--runtime` refused (`start/runtime.ts`),
 * an unusable config, a plan file that does not exist, a default branch,
 * a session record refusing the run or session records that cannot be
 * read or written, and a preflight that halts (a failed required
 * prerequisite, a PREREQUISITES file that cannot be read, or checks the
 * store refused) each throw exit code 1 with the whole refusal as the message,
 * which the dispatcher writes to stderr in text mode as the loop printed
 * it before and carries in the result in json mode. An interrupted task
 * throws exit code 0 once it is marked and its report stored and triaged.
 * A failed task, a blocked one and a report left unstored still stop the
 * run by returning, which the dispatcher ends as a success, with exit
 * code 0. A triage failure stops nothing.
 *
 * A SIGINT interrupts the run whether a terminal's Ctrl-C sends it to the
 * loop's process group or `rafa loop stop` sends it to the loop's pid
 * alone. The handler passes it on to the Claude session running at that
 * moment (`utils/claude.ts`), so the task ends then rather than when its
 * session would have, and the task is marked `[BLOCKED]`.
 */
import type { ResolvedConfig } from './config.js';
import type { FindingOutcome } from './effort/store/findings.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { activeOutput } from './adapters/output/active.js';
import { CommandExit } from './cli/command.js';
import { ConfigError } from './config.js';
import { isBudgetExit, markBudgetExit } from './start/budget.js';
import { finishCleanExit } from './start/commit.js';
import {
  dispatchTask,
  renderProgressForDispatch,
  storeTaskReport,
} from './start/dispatch.js';
import { holdWhilePaused } from './start/pause.js';
import { resolvePlanPath } from './start/plan-path.js';
import {
  DEFAULT_CI_ATTEMPTS,
  DEFAULT_CI_TIMEOUT_MIN,
  verifyPullRequest,
} from './start/pr-lifecycle.js';
import { runStartPreflight } from './start/preflight.js';
import {
  announcePlanIssues,
  argValue,
  injectSourceLabel,
  loadRunConfig,
  refuseDetachedRun,
} from './start/run-config.js';
import { runFromSelectedRuntime } from './start/runtime.js';
import { openRunSession } from './start/session.js';
import { setActivePlanStub } from './start/stamp.js';
import { createStartTriage } from './start/triage.js';
import { preserveProgress } from './start/wrap-up.js';
import { checkUsage, interruptClaudeSessions } from './utils/claude.js';
import { getCurrentBranch } from './utils/git.js';
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
 *
 * The refusal is thrown as a `CommandExit` with exit code 1 whose
 * message is the whole refusal, the lines the guard printed before it
 * threw, joined. Both warnings go through the active output.
 */
export function guardRunBranch(
  planStub: string | null,
  branch: string,
  args: readonly string[],
): void {
  if (args.includes('--any-branch')) {
    activeOutput().warn(`\n⚠️  --any-branch: running on \`${branch}\` without the branch check.`);
    return;
  }

  if (DEFAULT_BRANCHES.includes(branch)) {
    const name = planStub ?? 'this-plan';
    throw new CommandExit(1, [
      `\n❌ Refusing to run a plan on \`${branch}\`.`,
      '   A plan run needs its own branch: that is what gives it a PR to',
      '   review, and what lets the wrap-up\'s CI stage have something to',
      '   wait on. Run on main and both are silently skipped.',
      `\n   git checkout -b feat/${name}`,
      '\n   Pass --any-branch to run here anyway.',
    ].join('\n'));
  }

  if (planStub !== null && !branch.includes('/')) {
    activeOutput().warn(`\n⚠️  Branch \`${branch}\` carries no \`<type>/\` prefix.`);
    activeOutput().warn('   The run proceeds; the convention is `feat/<plan-stub>`.');
  }
}

/**
 * Runs the loop over the words of its line, on the project at `repoRoot`:
 * the root the dispatcher resolved from the nearest `.rafa/config.yaml`
 * at or above the working directory, handed over by
 * `src/commands/wrap.ts`.
 */
export default async function start(args: string[], repoRoot: string): Promise<void> {
  // Before anything is read: `-d|--detached` is declared, and refused until phase 6.
  refuseDetachedRun(args);
  // Then `--runtime`: an installed rafa other than this one runs the whole run instead.
  if (await runFromSelectedRuntime({ args, root: repoRoot })) return;

  // Before the deferral: a run queued for 23:00 that only meets a refused
  // config then has lost the night, where refusing now costs one command.
  let runConfig: ResolvedConfig;
  try {
    runConfig = loadRunConfig({ root: repoRoot, home: homedir() }, args);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const problems = error.problems.map((problem) => `   ${problem}`);
    throw new CommandExit(1, ['❌ Refusing to start on this configuration:', ...problems].join('\n'));
  }
  const { inject: injectMode, settingSources } = runConfig.config;

  const startAt = argValue(args, '--start-at');
  if (startAt) await deferUntil(startAt);

  const ciWait = !args.includes('--no-ci-wait');
  const ciTimeoutMin = Number(argValue(args, '--ci-timeout') ?? DEFAULT_CI_TIMEOUT_MIN);
  const ciAttempts = Number(argValue(args, '--ci-attempts') ?? DEFAULT_CI_ATTEMPTS);

  // Default plan: PLAN.md in plan.dir, else at the root (`start/plan-path.ts`).
  const planPath = resolvePlanPath(repoRoot, runConfig.config.planDir, argValue(args, '--plan'));

  const rootPromptPath = path.join(repoRoot, 'PROMPT.md');
  const promptPath = fs.existsSync(rootPromptPath)
    ? rootPromptPath
    : path.join(__dirname, 'PROMPT.md');

  const trackerPath = trackerPathFor(planPath);

  if (!fs.existsSync(planPath)) {
    throw new CommandExit(1, `❌ Plan file not found: ${planPath}`);
  }

  const planStub = planStubFromPath(planPath);
  const branch = getCurrentBranch();
  guardRunBranch(planStub, branch, args);
  setActivePlanStub(planStub);

  // Refuses a second run of the plan before anything else is printed or
  // checked; every way out of the `try` writes the run's end.
  const session = openRunSession({ repoRoot, planPath, planStub, branch });
  try {
    const planContent = fs.readFileSync(planPath, 'utf8');
    const promptContent = fs.readFileSync(promptPath, 'utf8');

    const injectSource = injectSourceLabel(runConfig);
    activeOutput().info(`🧭 Task sessions are handed the plan as \`${injectMode}\` (${injectSource}); the wrap-up is handed all of it.`);
    announcePlanIssues(planContent);

    // Throws on a halt, before the tracker and before any session.
    const { knownMissing } = await runStartPreflight({
      repoRoot,
      planPath,
      settings: runConfig.config,
      newRunId: () => session.id,
    });

    // Resolves no tracker here: the chain waits for the first public bug.
    const triageTask = createStartTriage({ repoRoot, config: runConfig.config });

    // Initialize tracker only if it doesn't exist
    if (!fs.existsSync(trackerPath)) {
      activeOutput().info(`📋 Creating new plan tracker at ${path.basename(trackerPath)}...`);
      fs.copyFileSync(planPath, trackerPath);
    } else {
      activeOutput().info(`📋 Resuming from existing ${path.basename(trackerPath)}...`);
    }

    // SIGINT: flag, pass it on to the running session so its task ends now,
    // and finish cleanup (mark blocked, throw exit 0) after the await returns.
    process.on('SIGINT', () => {
      interrupted = true;
      interruptClaudeSessions();
    });

    while (true) {
      if (interrupted) break;
      // Holds here while `rafa loop pause` has the record read `paused`.
      await holdWhilePaused({ repoRoot, sessionId: session.id, isInterrupted: () => interrupted });
      if (interrupted) break;

      const trackerContent = fs.readFileSync(trackerPath, 'utf8');
      const taskInfo = findNextTask(trackerContent);

      // Before the session it is for, whichever it is: a task or the wrap-up.
      if (!renderProgressForDispatch(repoRoot, planStub)) return;

      if (!taskInfo) {
        session.wrapUpStarted();
        activeOutput().info('\n✅ All tasks completed!');
        activeOutput().info('🧹 Wrap-up session starting: promote progress.txt findings, sync with main, then commit, push and open the PR.');
        activeOutput().info('   This is one full Claude session with no intermediate output — expect several quiet minutes. Interrupting it skips the push and PR; if that happens, run again to retry just this stage.');
        await preserveProgress(planContent, settingSources);
        if (ciWait) {
          await verifyPullRequest(
            Math.max(1, ciTimeoutMin) * 60_000,
            Math.max(0, ciAttempts),
            settingSources,
          );
        }
        session.finished();
        break;
      }

      session.taskStarted(taskInfo);
      const dispatch = await dispatchTask({
        taskInfo,
        promptContent,
        planContent,
        inject: injectMode,
        repoRoot,
        home: homedir(),
        settingSources,
        knownMissing,
      });
      const { exitCode } = dispatch;

      // Stored once the task's fate is known, and never before: the
      // outcome goes on every row the report is stored as. Triage follows
      // the store and the mark, and stops nothing (`start/triage.ts`).
      const storeReport = async (outcome: FindingOutcome): Promise<boolean> => {
        const stored = storeTaskReport({ repoRoot, planStub, dispatch, outcome });
        await triageTask({ trackerPath, lineNum: taskInfo.lineNum, planStub, dispatch, outcome });
        return stored;
      };

      if (interrupted) {
        updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
        activeOutput().info('\n⚠️  Interrupted. Task marked as blocked. Run again to resume.');
        await storeReport('blocked');
        throw new CommandExit(0);
      }

      // Ahead of any other failed session: marked with its blocker text.
      if (isBudgetExit(dispatch)) {
        markBudgetExit({ trackerPath, taskInfo, dispatch });
        await storeReport('blocked');
        return;
      }

      if (exitCode !== 0) {
        updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
        activeOutput().error(`\n❌ Task failed (exit ${exitCode}). Marked as blocked. Run again to retry.`);
        await storeReport('failed');
        return;
      }

      const finished = finishCleanExit({
        trackerPath,
        taskInfo,
        repoRoot,
        output: dispatch.output,
      });
      const stored = await storeReport(finished.outcome);
      if (finished.outcome !== 'done') return;
      if (!stored) {
        activeOutput().error('   Stopping here. The task stays ticked, so the next run starts after it.');
        return;
      }

      const shouldPause = await checkUsage('task');
      if (shouldPause) {
        activeOutput().info('\n⚠️  Pausing task loop due to high Claude usage. Run again when usage is lower.');
        break;
      }
    }
  } finally {
    session.end();
  }
}
