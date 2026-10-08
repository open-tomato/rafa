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
 * Two directories, never confused (`start/checkout.ts`). The PROJECT
 * ROOT is the dispatcher's root, the one holding `.rafa/`: the config,
 * the plan and its tracker, `PROMPT.md`, the session record, the
 * preflight, the store, the learning adapter and triage are all read
 * and written there. The CHECKOUT is the working tree the run was
 * started in, when it is one of the project's own: every git command
 * runs there — the branch read, offered and guarded, each task's
 * commit, the release's files, commit and push, and the CI gate — and
 * every session, task, wrap-up and CI repair alike, is spawned there,
 * with `progress.txt` written there for it to read. From a linked
 * worktree that is the worktree, and under `--as-worktree` it is the
 * worktree the run adds for the plan's branch; the run says so once
 * either way. Everywhere else it is the project root. Both are settled
 * in `start/run-checkout.ts`.
 *
 * Ahead of the branch guard, a run started on `main` or `master` is
 * offered the plan's own branch (`resolveRunBranch` in
 * `start/run-setup.ts`, the offer itself in `start/branch.ts`): with a
 * terminal it is asked whether to create
 * `feat/<plan-stub>` from the latest `origin/<base>` and run there, or
 * whether to switch to that branch when it already exists, and
 * `--create-branch` answers yes without asking. A run that moved carries
 * the new branch into the guard and into the session record below, so
 * neither reads the base the run started on. Nothing is offered under
 * `--any-branch`, for a plan whose file names no stub, or with no
 * terminal and no flag, and the guard then has the last word as it
 * always did. Every refusal along the way — a modified tracked file, a
 * fetch that failed, a base that has diverged — is thrown from there as
 * exit code 1, and leaves the run on its base.
 *
 * `--as-worktree` takes the place of that offer: no question is asked,
 * and `feat/<plan-stub>` is cut from the latest `origin/<base>`, or taken
 * when it exists, and added as a linked worktree at
 * `loop.worktreeDir/<stub>` (`start/worktree.ts`), which becomes the
 * run's checkout. An existing branch holding only claim commits merges
 * `origin/<base>` there before the first task, and one with other work
 * that is behind it is reported (`start/claim-catch-up.ts`). The main
 * checkout is never switched, and every session is still served from
 * its `.rafa/` (`start/serving.ts`).
 *
 * Once the branch guard lets the run through, the run prints the plan's
 * risk total, the one line `rafa plan risk` ends its report with
 * (`start/risk-total.ts`), on every run whether the standing notices are
 * pending or dismissed, and then asks for those notices
 * (`notices/run.ts`). A reading that throws is a warning and stops
 * nothing.
 *
 * Once the notices are answered, and before anything else is printed or
 * checked, the run opens its session (`start/session.ts`): it
 * writes `.rafa/runs/<session-id>.json` under a new id, naming the plan's
 * stub and path, the branch, this process's pid, the start time, the state
 * `running` and no task (`loop/sessions.ts`), and under `--roadmap` the
 * `rafa next --roadmap` hop that is away, when one is. A record of the plan refuses
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
 * Every run, worktree or not, holds its checkout to its branch at the
 * HEAD it started from, moved on by each commit a task's attempt makes
 * (`start/checkout-watch.ts`). Before each task is dispatched, and
 * before `progress.txt` is written into the checkout, the loop guard
 * reads the checkout (`start/checkout-guard.ts`), and again before each
 * task commit. A checkout on another branch, at another commit, or gone
 * marks the task `[BLOCKED]` with `checkout moved` as its blocker text
 * and stops the run: no further session is spawned, nothing is
 * committed, the checkout is not switched back, and the output names the
 * branch expected, what was found and the one command that restores it.
 * The guard runs once more inside the dispatch, immediately before the
 * session is spawned, and halts the same way, so a checkout removed
 * after the first guard never reaches the spawn.
 * A halt before the commit stores the session's report as `blocked`. The guard
 * also runs before the wrap-up session, marking nothing since the
 * wrap-up has no tracker line, and before the loop's release commit,
 * where it holds only the branch: the wrap-up session commits itself.
 *
 * Before the tracker is created and before any session is spawned, the
 * wrap-up's included, the run's preflight checks the configured
 * prerequisites and those of the plan's `PREREQUISITES-<stub>.md`, and
 * stores a row per check under the session's id as its run id
 * (`start/preflight.ts`). A failed required item refuses the run. Each
 * failed optional one becomes a `known-missing:` line that every task
 * prompt carries after its plan text, with one sentence saying such an
 * item is neither a bug to fix nor a credential to patch around. Ahead
 * of every probe, the same preflight refuses a run whose checklist
 * routes a still-to-run task to an `agent=` no loaded tier serves under
 * `loop.settingSources`, `tiers.rafa` and the pins: one no tier holds,
 * one switched off, or one two tiers hold with different contents. That
 * dispatch would exit 1 before any model call.
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
 * The runner runs the slower tests itself, as recorded steps of the run
 * (`start/suite-steps-run.ts` over `start/suite-step.ts`), each appended
 * to the run record's `steps` before the loop acts on it. Past the loop
 * guard and ahead of rendering `progress.txt`, the first session of the
 * run, task or wrap-up, is preceded by the suite baseline: the one
 * stored beside the tracker, or the full suite at HEAD. Before each open
 * task every stage step due runs, the step after a stage's last task and
 * the catch-up for one that never ran; before a `[BLOCKED]` task none
 * runs, so a repair gets its session first and the steps still due wait
 * for the next open task; before the wrap-up, the full suite runs as the
 * pre-wrap-up step. Once a task is committed `done` and its
 * report stored, the task step runs over what it changed since the
 * commit it was dispatched on, the base its prompt names, lints the
 * files it changed (`start/lint-step.ts`), and type-checks the test
 * files it changed against the same files at that base
 * (`start/type-step.ts`). A step with failures the baseline does not
 * hold, or a task step with ESLint errors or a type error its base did
 * not hold, is red: it inserts a `[BLOCKED]` repair task above the first
 * open task, or blocks
 * the repair it followed (`start/suite-blocker.ts`), and the run stops as
 * it does after a blocked task, so the next run dispatches that repair
 * handed the failing files. A red pre-wrap-up step inserts its repair
 * after the checklist's last task and the loop turns back to dispatch
 * it in the same run, then runs the pre-wrap-up step again; red a second
 * time, it blocks that repair again and the run stops before the
 * wrap-up.
 * Each task prompt lists the baseline's failures as inherited
 * (`start/inherited-notice.ts`), read again before each dispatch.
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
 * Then, whatever became of the task, the run pushes the store's rows to
 * the project's other devices and pulls theirs, through the one contact
 * it makes for the whole run (`effort/sync/contact.ts`). `local` and
 * `file` are not contacted. A contact never throws, and it writes at most
 * one line per run saying the hub is unreachable, so a hub that is down
 * stops no task and does not repeat that line on every task.
 * Its pulls name the run's session id, so the merge's live-loop guard
 * passes the run's own record, matched by session id and never by pid.
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
 * --skills-resolver the resolver that picks each task's skills: planner, tag
 *               or none. Outranks `task.skills` in `.rafa/config.yaml`, for
 *               this run only (`start/run-config.ts`).
 * --runtime     the installed rafa the run goes on in: a version under
 *               `~/.rafa/runtime/`, or a path to a `cli.js` or its directory
 *               (`start/runtime.ts`).
 * --create-branch on `main` or `master`, create `feat/<plan-stub>` from the
 *               latest `origin/<base>` and run there without asking, or
 *               switch to that branch when it is already there
 *               (`start/branch.ts`). Read by `start/run-setup.ts` alone.
 * --as-worktree run in a linked worktree of `feat/<plan-stub>` at
 *               `loop.worktreeDir/<stub>`, created from the latest
 *               `origin/<base>` when the branch is not there yet, and leave
 *               the main checkout as it is (`start/run-checkout.ts`).
 * --any-branch  run where the loop stands, whatever branch that is: no
 *               offer is made and the guard (`start/run-setup.ts`)
 *               checks nothing.
 * --roadmap     stamp the hop record, when a hop is away, on the run's
 *               session record as its `hop` (`start/session.ts`). What
 *               `rafa next --roadmap` passes to the loop it starts.
 * --no-ci-wait  finish at the push instead of waiting for CI.
 * --ci-timeout  minutes to wait for checks to settle (default 20).
 * --ci-attempts repair sessions to spend on a red or conflicting PR
 *               before escalating (default 2; 0 disables repair but
 *               still reports the verdict).
 * --retry       re-enter the loop up to n times (1 to 3) after a
 *               retry-safe stop; outranks `loop.retries`, `false` unless
 *               a config names a count, or `loop.retriesOnContinue`, 1
 *               unless a config names another, under `--continue`
 *               (`start/retry-budget.ts`).
 * --continue    hand a stop that would end the run to a decision: retry
 *               with a new approach, stop, jump over the task, or defer
 *               it; `--decide=<strategy>` (with `--approach=<text>` or
 *               `--after=<line>`) names the decision on the line, and
 *               `--force-wrap-up` wraps up a run that passed tasks over
 *               (`start/continue-args.ts`).
 *
 * After the last task the loop runs its wrap-up branch
 * (`start/wrap-up-run.ts`): a wrap-up session (`start/wrap-up.ts`:
 * promote findings, sync with main, commit, push, open or update the PR)
 * and then WAITS on that PR's checks (`start/pr-lifecycle.ts`). A
 * conflicting PR gets no CI run at all, so without this last stage the
 * loop can report a finished plan whose code was never checked once.
 *
 * The release is wrapped around that session, in three parts
 * (`start/release-stage.ts`). Before it is spawned, the loop writes the
 * plan's change fragment, or says why it wrote none, and hands that
 * record to the session, whose prompt asks it to rewrite the fragment's
 * raw notes and to leave it unstaged. Once the session returns, and
 * BEFORE the CI gate, the loop verifies that rewrite, restores its own
 * text on a refusal, commits and pushes the fragment alone under
 * `chore: release fragment <plan id>`, and writes a forecast of what it
 * ships into the pull request body. Every outcome short of a pushed
 * fragment puts one sentence in the pull request body instead. A stage
 * that could not run at all prepares nothing, and the wrap-up runs
 * without a release rather than not at all.
 *
 * Every line this module, `start/run-config.ts`, `start/run-setup.ts`, `start/checkout.ts`, `start/checkout-watch.ts`, `start/worktree.ts`, `start/runtime.ts`, `start/session.ts`,
 * `start/risk-total.ts`, `start/preflight.ts`, `start/commit.ts`, `start/budget.ts`,
 * `start/triage.ts`, `start/release-stage.ts`, `start/wrap-up.ts`, `start/wrap-up-run.ts`,
 * `start/suite-step.ts`, `start/suite-steps-run.ts`, `start/retry-budget.ts` and
 * `start/continue-run.ts` write goes
 * through the active output
 * (`adapters/output/active.ts`): what went to `console.log` through
 * `info`, `console.warn` through `warn` and `console.error` through
 * `error`, each message as it was. Under the dispatcher that is the
 * invocation's output, so json mode reads each as a `log` event.
 *
 * The run is refused by throwing `CommandExit` (`cli/command.ts`) and
 * never by `process.exit`, so the dispatcher writes the terminal event.
 * A line asking for `-d|--detached`, refused before anything else is
 * read (`start/run-config.ts`), `--as-worktree` beside
 * `--create-branch`, refused right after it (`start/run-setup.ts`), a
 * `RAFA_EFFORT_DIR` set in the environment, refused next
 * (`start/run-config.ts`), a `--runtime`
 * refused (`start/runtime.ts`),
 * an unusable config, `--as-worktree` while a `tracking` setting is
 * on (`start/run-setup.ts`), a plan file that does not exist, a checkout git
 * could not read (`start/checkout.ts`), a branch offer
 * that could not be taken (`start/branch.ts`), a checkout the loop guard
 * cannot hold (`start/checkout-watch.ts`), a worktree git would not
 * add (`start/worktree.ts`), a default branch the run
 * stayed on,
 * a session record refusing the run or session records that cannot be
 * read or written, and a preflight that halts (a failed required
 * prerequisite, a PREREQUISITES file that cannot be read, or checks the
 * store refused) each throw exit code 1 with the whole refusal as the message,
 * which the dispatcher writes to stderr in text mode as the loop printed
 * it before and carries in the result in json mode. An interrupted task
 * throws exit code 0 once it is marked and its report stored and triaged.
 * A failed task, a blocked one, a checkout that moved, a report left
 * unstored and a red or interrupted suite step still stop the run by
 * returning, which the dispatcher ends as a success, with exit code 0. A
 * triage failure stops nothing. Under `--retry` or `loop.retries` four
 * of those stops `continue` instead while a retry is left: a red suite
 * step before a session or after a task, a session that exited nonzero
 * but not on its budget, and a clean exit held only on leaving neither
 * a report nor a commit; each retry writes a warning and a `retry`
 * event (`start/retry-budget.ts`), and no `task-blocked` event, which
 * a task stop emits only once no retry is granted, so the run really
 * stops. The attempt's report is stored either way. A checkout moved
 * from the loop's last commit refuses the retry, spending none: the
 * next pass's loop guard would halt on it and block the task on
 * `checkout moved` in place of its own stop.
 *
 * Under `--continue` a stop the retries do not take is handed to a
 * decision (`start/continue-run.ts`): a report that holds its task at
 * once, and a retry-safe stop once its retries are spent. A `retry`
 * writes its approach on the task's line and spends a retry, a `jump`
 * or `defer` passes the task over (`findNextTask` skips its line), and
 * a `stop` ends the run with exit code 20. A run left with only
 * passed-over tasks ends with exit code 22 before the pre-wrap-up step.
 *
 * Every event the run emits is appended to its events file,
 * `.rafa/runs/<session-id>.events.ndjson` (`start/loop-events.ts`),
 * bound right after the session record is opened and unbound in the
 * run's `finally`. Anything the run throws past that point, a
 * `CommandExit` included, is first written there as an `error` event
 * and then rethrown unchanged, but for a `LoopEnd`: the end a
 * `--continue` run chose, with exit code 20, 21 or 22, which emitted
 * its own events before it was thrown (`start/continue-exits.ts`).
 *
 * A SIGINT interrupts the run whether a terminal's Ctrl-C sends it to the
 * loop's process group or `rafa loop stop` sends it to the loop's pid
 * alone. The handler passes it on to the Claude session running at that
 * moment (`utils/claude.ts`), so the task ends then rather than when its
 * session would have, and the task is marked `[BLOCKED]`. A SIGINT during
 * a suite step, whether it ended `bun test` or reached the loop alone, is
 * a stop and not a red step (`start/suite-step.ts`): the step is recorded
 * `interrupted`, no task is marked, and the run returns, its record
 * `stopped`, as it does when a pause's hold ends on the signal.
 */
import type { ResolvedConfig } from './config.js';
import type { FindingOutcome } from './effort/store/findings.js';
import type { TaskLearning } from './start/dispatch.js';
import type { TaskHandout } from './start/handout.js';
import type { SessionServing } from './start/serving.js';
import type { WrapUpLearning } from './start/wrap-up.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { activeOutput } from './adapters/output/active.js';
import { CommandExit } from './cli/command.js';
import { messageOf } from './config-sections.js';
import { ConfigError } from './config.js';
import { createHubContact } from './effort/sync/contact.js';
import { requireNoticesAnswered } from './notices/run.js';
import { createGitRunner } from './pr/index.js';
import { isBudgetExit, markBudgetExit } from './start/budget.js';
import { guardCheckout } from './start/checkout-guard.js';
import {
  advanceExpectation,
  haltIfCheckoutMoved,
  haltIfWrapUpMoved,
  openCheckoutExpectation,
} from './start/checkout-watch.js';
import { announceRunDirs } from './start/checkout.js';
import { finishCleanExit, heldOnNothingLeftBehind } from './start/commit.js';
import { configuredRetries, refuseUnusableCriteria } from './start/continue-args.js';
import { LoopEnd } from './start/continue-exits.js';
import { createRunDecisions } from './start/continue-run.js';
import {
  dispatchTask,
  renderProgressForDispatch,
  storeTaskReport,
} from './start/dispatch.js';
import {
  bindEventsFile,
  emitLoopEvent,
  taskPosition,
  taskTokens,
  unbindEventsFile,
  unlessText,
} from './start/loop-events.js';
import { holdWhilePaused } from './start/pause.js';
import { resolvePlanPath } from './start/plan-path.js';
import { createStartPreflightClaim } from './start/preflight-claim.js';
import { createStartPreflightDrift } from './start/preflight-drift.js';
import { runStartPreflight } from './start/preflight.js';
import { createRunRetries, resolveRunRetries } from './start/retry-budget.js';
import { announceRiskTotal } from './start/risk-total.js';
import { settleRunCheckout } from './start/run-checkout.js';
import {
  announcePlanIssues,
  injectSourceLabel,
  loadRunConfig,
  refuseDetachedRun,
  refuseEffortDirRun,
} from './start/run-config.js';
import {
  guardRunBranch,
  readRunArgs,
  refuseWorktreeBesideCreateBranch,
  refuseWorktreeWhileTracking,
} from './start/run-setup.js';
import { runFromSelectedRuntime } from './start/runtime.js';
import { openRunSession, readPreviousPassOver } from './start/session.js';
import { setActivePlanStub } from './start/stamp.js';
import { createRunSuiteSteps } from './start/suite-steps-run.js';
import { readAlwaysRunFiles } from './start/task-gate-lines.js';
import { createStartTriage, runStartFailures } from './start/triage.js';
import { runWrapUp } from './start/wrap-up-run.js';
import { interruptClaudeSessions } from './utils/claude.js';
import { parseTaskDeclaration } from './utils/declaration.js';
import { planStubFromPath } from './utils/plan-stamp.js';
import { deferUntil } from './utils/schedule.js';
import { findNextTask, trackerPathFor, updateTrackerLine } from './utils/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let interrupted = false;

/**
 * Runs the loop over the words of its line, on the project at `repoRoot`:
 * the root the dispatcher resolved from the nearest `.rafa/config.yaml`
 * at or above the working directory, or the main checkout's from a
 * linked worktree with none, handed over by `src/commands/wrap.ts`. The
 * checkout git and the sessions run in is resolved here, once the plan
 * is known to exist; see the module note.
 */
export default async function start(args: string[], repoRoot: string): Promise<void> {
  // Before anything is read: `-d|--detached` is declared, and refused until phase 6.
  refuseDetachedRun(args);
  // Then two flags that each make the plan's branch, one of them in a worktree.
  refuseWorktreeBesideCreateBranch(args);
  // Then a store override: a loop records to the project's own store, never to a copy.
  refuseEffortDirRun(process.env);
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
  // A worktree beside tracked `.rafa/` content would carry a second copy of it.
  refuseWorktreeWhileTracking(args, runConfig.config);
  const { inject: injectMode, settingSources } = runConfig.config;

  // Every flag `start()` reads itself, read once (`start/run-setup.ts`).
  const { startAt, plan, ciWait, ciTimeoutMin, ciAttempts, roadmap, retry, continueRun } = readRunArgs(args);
  // Under `--continue`, criteria a decision could not be made by refuse
  // the run now rather than at its first decision (`start/continue-args.ts`).
  refuseUnusableCriteria(continueRun, repoRoot, runConfig.config);
  if (startAt) await deferUntil(startAt);

  // Default plan: PLAN.md in plan.dir, else at the root (`start/plan-path.ts`).
  const planPath = resolvePlanPath(repoRoot, runConfig.config.planDir, plan);

  const rootPromptPath = path.join(repoRoot, 'PROMPT.md');
  const promptPath = fs.existsSync(rootPromptPath)
    ? rootPromptPath
    : path.join(__dirname, 'PROMPT.md');

  const trackerPath = trackerPathFor(planPath);

  if (!fs.existsSync(planPath)) {
    throw new CommandExit(1, `❌ Plan file not found: ${planPath}`);
  }

  const planStub = planStubFromPath(planPath);
  // Where git runs and every session is spawned, and the branch there
  // (`start/run-checkout.ts`): the working tree the run was started in,
  // on `main` or `master` offered `feat/<stub>` first, or under
  // `--as-worktree` the worktree added for that branch. The branch is the
  // one the guard reads and the session record below names, so a run
  // that moved is never guarded on, and never records, the base it
  // started from.
  const { checkout, branch } = await settleRunCheckout({
    projectRoot: repoRoot,
    worktreeDir: runConfig.config.loopWorktreeDir,
    planStub,
    args,
  });
  guardRunBranch(planStub, branch, args);
  // What the loop guard holds the checkout to: its branch at the HEAD it
  // starts from, moved on by each task commit (`start/checkout-watch.ts`).
  let expected = openCheckoutExpectation({ projectRoot: repoRoot, checkout, branch });

  // The plan's risk total, on every run and ahead of the notices below, so
  // the count is read before consent is asked (`start/risk-total.ts`).
  await announceRiskTotal({
    repoRoot,
    home: homedir(),
    planPath,
    config: runConfig.config,
    environment: process.env,
  });
  // Past the guard, so a run that is refused says only why, and ahead of
  // the session record and every session: the alpha and the
  // skip-permissions notices, until the person dismisses them
  // (`notices/notices.ts`). A cancel here leaves the run on the branch the
  // offer above may have created, with nothing run on it.
  await requireNoticesAnswered();
  setActivePlanStub(planStub);

  // Refuses a second run of the plan before anything else is printed or
  // checked; every way out of the `try` writes the run's end. Under
  // `--roadmap` the record carries the away hop, when there is one, and
  // a run in a worktree carries the worktree's path. The run's events
  // file, `<session-id>.events.ndjson` beside the record, is bound
  // straight after and unbound in the `finally`; anything the run throws
  // is written to it as an `error` event before it is rethrown
  // (`start/loop-events.ts`).
  const session = openRunSession({ repoRoot, planPath, planStub, branch, roadmap, checkout });
  bindEventsFile(repoRoot, session.id);
  try {
    const planContent = fs.readFileSync(planPath, 'utf8');
    const promptContent = fs.readFileSync(promptPath, 'utf8');

    const injectSource = injectSourceLabel(runConfig);
    announceRunDirs({ projectRoot: repoRoot, checkout });
    activeOutput().info(`🧭 Task sessions are handed the plan as \`${injectMode}\` (${injectSource}); the wrap-up is handed all of it.`);
    announcePlanIssues(planContent);

    // Throws on an unserved `effort.sync`, an unresolvable agent, a claim
    // this device does not own or a halt, before the tracker and before
    // any session.
    const { knownMissing } = await runStartPreflight({
      repoRoot,
      planPath,
      settings: runConfig.config,
      newRunId: () => session.id,
      agents: {
        settingSources,
        tiersRafa: runConfig.config.tiersRafa,
        tiersSkills: runConfig.config.tiersSkills,
        tiersAgents: runConfig.config.tiersAgents,
        home: homedir(),
      },
      sync: { resolved: runConfig, home: homedir() },
      claim: createStartPreflightClaim(repoRoot, runConfig.config),
      drift: createStartPreflightDrift(repoRoot, runConfig.config),
    });

    // What each session, task and wrap-up alike, is served against: the
    // run's `.rafa/runs/<id>/served/`, refilled before every session
    // (`start/serving.ts`).
    const serving: SessionServing = { root: repoRoot, run: session.id, home: homedir(), settings: runConfig.config };

    // Where each stored report's lessons are pushed: the adapter the run's
    // `learning.adapter` names, resolved per push (`start/dispatch.ts`).
    const learning: TaskLearning = {
      kind: runConfig.config.learningAdapter,
      home: homedir(),
      blessMinConfidence: runConfig.config.learningBlessMinConfidence,
    };

    // What each task is handed beside the plan: the skills the run's
    // `task.skills` resolver picks and, under `task.lessons: on`, the
    // blessed lessons pulled from that same adapter (`start/handout.ts`).
    const handout: TaskHandout = {
      resolver: runConfig.config.taskSkills,
      lessons: runConfig.config.taskLessons,
      learning,
    };

    // Where the wrap-up reads the lessons it asks the session to promote:
    // the same adapter, at the run's `learning.promote.*` keys
    // (`start/wrap-up.ts`).
    const wrapUpLearning: WrapUpLearning = {
      ...learning,
      repoRoot,
      promoteAfter: runConfig.config.learningPromoteAfter,
      promoteMinConfidence: runConfig.config.learningPromoteMinConfidence,
    };

    // The run's one contact with the project's other devices, run at the
    // end of each task (`effort/sync/contact.ts`): it warns at most once
    // that the hub is unreachable, and never throws. Its pulls name the
    // run's session id, so the merge's live-loop guard passes this run's
    // own record and still refuses any other live one.
    const hubContact = createHubContact({
      root: repoRoot,
      home: homedir(),
      resolved: runConfig,
      warn: (message) => activeOutput().warn(message),
      sessionId: session.id,
    });

    // Resolves no tracker here: the chain waits for the first public bug.
    const triageTask = createStartTriage({ repoRoot, config: runConfig.config });

    // The runner's suite steps around the sessions (`start/suite-steps-run.ts`):
    // `bun test` run here, in the checkout, and recorded on the run record.
    const suiteSteps = createRunSuiteSteps({
      repoRoot,
      checkout,
      trackerPath,
      sessionId: session.id,
      settings: runConfig.config,
      planContent,
      isInterrupted: () => interrupted,
    });

    // The retries this run takes in place of a halt, at the four
    // retry-safe stops below alone: `--retry` over `loop.retries`, or
    // over `loop.retriesOnContinue` under `--continue`, none unless one
    // names a count (`start/retry-budget.ts`). A checkout moved from
    // `expected`, as it reads at the stop, refuses one.
    const retries = createRunRetries({
      retries: resolveRunRetries(retry, configuredRetries(runConfig.config, continueRun.on)),
      isInterrupted: () => interrupted,
      isCheckoutHeld: () => guardCheckout(expected).held,
    });

    // Under `--continue`, a stop the retries do not take is handed to a
    // decision, and the tasks it passes over are skipped below
    // (`start/continue-run.ts`); without it, nothing changes. The run
    // opens with the list the plan's last stopped run saved.
    const decisions = createRunDecisions({
      continueArgs: continueRun,
      repoRoot,
      checkout,
      trackerPath,
      planPath,
      settings: runConfig.config,
      settingSources,
      session,
      retries,
      isInterrupted: () => interrupted,
      seed: continueRun.on
        ? readPreviousPassOver(repoRoot, { planPath, planStub })
        : [],
    });

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
      const taskInfo = findNextTask(trackerContent, { skipLines: decisions.skipLines(trackerContent) });
      // No task left but the ones a `--continue` run passed over: the run
      // ends here, before the pre-wrap-up step and the wrap-up.
      if (!taskInfo) decisions.atPlanEnd(trackerContent);

      // The loop guard, before anything is written into the checkout: a
      // moved or missing one marks the task `[BLOCKED]`, or before the
      // wrap-up marks nothing, and stops the run.
      const moved = taskInfo
        ? haltIfCheckoutMoved({ expected, trackerPath, taskInfo })
        : haltIfWrapUpMoved({ expected, before: 'dispatch' });
      if (moved) {
        emitLoopEvent({ kind: 'halt', reason: 'checkout moved' });
        return;
      }

      // The baseline at the first dispatch, then the stage steps due
      // before an open task (none before a blocked one, which is the
      // repair a red step left and runs first) or the pre-wrap-up step
      // before the wrap-up. A red stage step has inserted a blocked
      // repair task, and a red one stops the run as a blocked task does.
      // A red pre-wrap-up step's first repair answers `repair` instead:
      // back to `findNextTask`, which answers that repair, so it runs in
      // this run and the pre-wrap-up step runs again after it.
      if (!taskInfo) emitLoopEvent({ kind: 'wrap-up', phase: 'tests' });
      const suiteGate = await suiteSteps.beforeSession(taskInfo);
      if (suiteGate === 'stop') {
        if (!suiteSteps.stoppedOnSignal() && retries.retry('suite step red')) continue;
        if (!suiteSteps.stoppedOnSignal() && await decisions.atStop({ kind: 'suite-red' })) continue;
        emitLoopEvent({ kind: 'halt', reason: 'suite step red' });
        return;
      }
      if (interrupted) break;
      if (suiteGate === 'repair') continue;

      // Before the session it is for, whichever it is: a task or the wrap-up.
      if (!renderProgressForDispatch(repoRoot, planStub, checkout)) return;

      if (!taskInfo) {
        // The wrap-up, the release around it and the CI gate
        // (`start/wrap-up-run.ts`); the loop ends however it returns.
        await runWrapUp({
          session,
          repoRoot,
          checkout,
          settings: runConfig.config,
          planStub,
          planContent,
          settingSources,
          serving,
          wrapUpLearning,
          expected,
          ciWait,
          ciTimeoutMin,
          ciAttempts,
          isInterrupted: () => interrupted,
        });
        break;
      }

      // The HEAD the checkout is held to is the task's base commit: the
      // session runs `bun test --changed=<base>` against it, and the task
      // step runs over what the task changed since it. The
      // `tests.alwaysRun` files are read per task, so a sweep an earlier
      // task added is named to the next one.
      const base = expected.head;
      const position = taskPosition(trackerContent, taskInfo.lineNum);
      const startedAt = Date.now();
      emitLoopEvent({ kind: 'task-start', position, text: parseTaskDeclaration(taskInfo.task).text });
      session.taskStarted(taskInfo);
      const dispatch = await dispatchTask({
        taskInfo,
        promptContent,
        planContent,
        inject: injectMode,
        repoRoot,
        checkout,
        home: homedir(),
        settingSources,
        knownMissing,
        inherited: runStartFailures(trackerPath),
        alwaysRun: readAlwaysRunFiles(createGitRunner(checkout), runConfig.config.testsAlwaysRun),
        serving,
        handout,
        base,
        guard: { expected, trackerPath },
      });
      const { exitCode } = dispatch;

      // The loop guard ran again just before the spawn: a checkout gone
      // since the guard above spawned nothing and marked the task blocked.
      if (dispatch.halted) {
        emitLoopEvent({ kind: 'task-blocked', position, reason: 'checkout moved' });
        emitLoopEvent({ kind: 'halt', reason: 'checkout moved' });
        return;
      }

      // Stored once the task's fate is known, and never before: the
      // outcome goes on every row the report is stored as, and the
      // dispatch row takes the resolver and what the prompt offered off
      // `dispatch` (`start/dispatch.ts`). Triage follows
      // the store and the mark, and stops nothing (`start/triage.ts`).
      // Last, the task's rows are pushed and the other devices' pulled.
      const storeReport = async (outcome: FindingOutcome): Promise<boolean> => {
        const stored = await storeTaskReport({ repoRoot, planStub, dispatch, outcome, learning });
        await triageTask({ trackerPath, lineNum: taskInfo.lineNum, planStub, dispatch, outcome });
        await hubContact.pushThenPull();
        return stored;
      };

      if (interrupted) {
        updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
        activeOutput().info('\n⚠️  Interrupted. Task marked as blocked. Run again to resume.');
        emitLoopEvent({ kind: 'task-blocked', position, reason: 'interrupted' });
        await storeReport('blocked');
        throw new CommandExit(0);
      }

      // Ahead of any other failed session: marked with its blocker text.
      if (isBudgetExit(dispatch)) {
        markBudgetExit({ trackerPath, taskInfo, dispatch });
        emitLoopEvent({ kind: 'task-blocked', position, reason: 'budget exceeded' });
        await storeReport('blocked');
        return;
      }

      if (exitCode !== 0) {
        updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
        activeOutput().error(`\n❌ Task failed (exit ${exitCode}). Marked as blocked. Run again to retry.`);
        // Stored on every attempt, retried or not. The retry is asked
        // after the store, so an interrupt during it refuses the retry,
        // and nothing is awaited between a grant and the loop's top.
        // `task-blocked` is the stop's alone: a retried one emits `retry`.
        await storeReport('failed');
        const failed = { kind: 'task-blocked', position, reason: `session exited ${exitCode}` } as const;
        if (retries.retry(`session exited ${exitCode}`)) continue;
        if (await decisions.atStop({ kind: 'session-exit', taskInfo, exitCode, stopEvent: failed })) continue;
        emitLoopEvent(failed);
        return;
      }

      // The loop guard before the task commit: a moved or missing checkout
      // commits nothing and stores the task blocked on `checkout moved`.
      if (haltIfCheckoutMoved({ expected, trackerPath, taskInfo, before: 'commit' })) {
        emitLoopEvent({ kind: 'task-blocked', position, reason: 'checkout moved' });
        emitLoopEvent({ kind: 'halt', reason: 'checkout moved' });
        await storeReport('blocked');
        return;
      }

      const finished = finishCleanExit({
        trackerPath,
        taskInfo,
        repoRoot: checkout,
        output: dispatch.output,
      });
      expected = advanceExpectation(expected, finished.attempt);
      const stored = await storeReport(finished.outcome);
      if (finished.outcome !== 'done') {
        const held = { kind: 'task-blocked', position, reason: finished.holds[0] ?? 'held by its report' } as const;
        if (heldOnNothingLeftBehind(finished) && retries.retry('left neither a report nor a commit')) continue;
        if (await decisions.atStop({ kind: 'clean-exit', taskInfo, finished, stopEvent: held })) continue;
        emitLoopEvent(held);
        return;
      }
      decisions.taskDone(taskInfo);
      const tokens = await unlessText(async () => taskTokens(checkout, dispatch.sessionId));
      emitLoopEvent({ kind: 'task-done', position, durationMs: Date.now() - startedAt, tokens });
      if (!stored) {
        activeOutput().error('   Stopping here. The task stays ticked, so the next run starts after it.');
        emitLoopEvent({ kind: 'halt', reason: 'task report not stored' });
        return;
      }

      // The task step over what the task changed since its base; a red
      // one has inserted a blocked repair task, or blocked the repair it
      // followed, and stops the run.
      if (!(await suiteSteps.afterTask(taskInfo, base))) {
        if (!suiteSteps.stoppedOnSignal() && retries.retry('suite step red')) continue;
        if (!suiteSteps.stoppedOnSignal() && await decisions.atStop({ kind: 'suite-red' })) continue;
        emitLoopEvent({ kind: 'halt', reason: 'suite step red' });
        return;
      }
    }
  } catch (error) {
    if (!(error instanceof LoopEnd)) emitLoopEvent({ kind: 'error', message: messageOf(error) });
    throw error;
  } finally {
    unbindEventsFile();
    session.end();
  }
}
