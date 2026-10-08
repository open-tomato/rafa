/**
 * The decisions of one `rafa loop start --continue` run: where a stop
 * that would end the run is handed to a decision, how that decision is
 * made, and what the loop does with it.
 *
 * `start()` makes one {@link RunDecisions} per run and asks it at four
 * places. Without `--continue` every answer is the one the loop made
 * before this module existed: no line is skipped, no stop is decided,
 * and nothing is written.
 *
 *   - {@link RunDecisions.skipLines} before every `findNextTask`: the
 *     lines of the tasks the run passes over (`./pass-over.ts`).
 *   - {@link RunDecisions.atStop} at a stop that would end the run;
 *     true sends the loop back to its top with `continue`.
 *   - {@link RunDecisions.taskDone} once a task is committed `done`, so
 *     the defers waiting on it are released.
 *   - {@link RunDecisions.atPlanEnd} when `findNextTask` answers no task:
 *     a run whose passed-over tasks are still open ends there.
 *
 * ## Where a decision is made
 *
 * At once, at a clean exit its own report holds (`status: blocked` or a
 * listed blocker). At a retry-safe stop (a red suite step, a session
 * that exited nonzero, a clean exit that left neither a report nor a
 * commit) only once the run's retries refused it for being spent
 * (`RunRetries.lastRefusal`, `./retry-budget.ts`): a retry refused for
 * an interrupt or a moved checkout halts as before. Never at a refused
 * commit, an exit on its budget, an interrupt, a pause, a moved
 * checkout, a report left unstored, a refusal before the loop, or the
 * wrap-up: those are not handed here. The task a suite stop decides on
 * is the line the red step blocked, the first `findNextTask` answers
 * past the skipped ones; a red step that blocked no line halts as before.
 *
 * ## How
 *
 * One session, spawned through `./decision-session.ts` with read-only
 * tools, handed `buildDecisionPrompt`'s prompt: the task and its line,
 * why it stopped, the retries left, every open task, and the criteria
 * `resolveContinueCriteria` reads again for each decision. Its output is
 * read by `parseDecision`, which answers `stop` for anything it cannot
 * read. A session that exits nonzero is read as `stop`; one SIGINT
 * ended halts the run as an interrupt always has, deciding nothing.
 *
 * ## What the loop does with it
 *
 *   - `retry`: the approach is written as the task's tracker blocker
 *     (`writeTrackerBlocker`), which the next dispatch hands its session,
 *     and one retry is spent through the run's budget. With none left,
 *     the `retry` is read as `stop`.
 *   - `stop`: the run ends with {@link DECISION_STOP_EXIT}.
 *   - `jump`: the task is added to the pass-over list; its line stays
 *     `[BLOCKED]` for a later run.
 *   - `defer`: the task is passed over until the task at `after` is
 *     done (`addDecision`); `after` naming no open task leaves it
 *     eligible at once.
 *
 * Two bounds keep a run from deciding forever. A task deferred once in
 * the run that is deferred again is passed over as a `jump`, and the
 * `decision` event's reason says so. A task passed over once in the run
 * that reaches a decision again (a red stage step inserts a repair of
 * the same text each time its step runs) is stopped, the reason saying
 * so, since passing it over again would only meet it again.
 *
 * Every decision emits one `decision` event (`./loop-events.ts`) and one
 * line. A stop emits, after it, the stop's own event (`task-blocked`, or
 * `halt` for a suite step), which is not emitted otherwise, and ends the
 * run by throwing a `LoopEnd` (`./continue-exits.ts`). The pass-over
 * list is written on the run's record each time it changes
 * (`RunSession.decisionsChanged`), and the run opens with the list the
 * plan's newest stopped run saved (`readPreviousPassOver`), handed in as
 * {@link RunDecisionsOptions.seed}.
 *
 * ## The end of the plan
 *
 * When `findNextTask` with the skipped lines answers no task while
 * passed-over tasks are still open, the run lists each with its
 * strategy and reason, emits `passed-over` and a `halt`, and ends with
 * {@link PASSED_OVER_EXIT}: no pre-wrap-up step, no wrap-up and no pull
 * request.
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { FinishedTask } from './commit.js';
import type { ContinueArgs } from './continue-args.js';
import type { ContinueDecision } from './decision-parse.js';
import type { LoopEvent, PassedOverTask } from './loop-events.js';
import type { PassOverList } from './pass-over.js';
import type { RetryRefusal, RunRetries } from './retry-budget.js';
import type { RunSession } from './session.js';
import type { ClaudeSettingSource, RafaConfig } from '../config.js';
import type { CapturingSpawner } from '../utils/claude.js';
import type { TaskInfo } from '../utils/tracker.js';

import { readFileSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { findNextTask, listOpenTasks, writeTrackerBlocker } from '../utils/tracker.js';

import { heldOnNothingLeftBehind } from './commit.js';
import { DECISION_STOP_EXIT, LoopEnd, PASSED_OVER_EXIT } from './continue-exits.js';
import { parseDecision } from './decision-parse.js';
import { buildDecisionPrompt, resolveContinueCriteria } from './decision-prompt.js';
import { runDecisionSession } from './decision-session.js';
import { emitLoopEvent } from './loop-events.js';
import { addDecision, markDone, remaining, skippedLines, taskIdentity } from './pass-over.js';

/** The reason of a red suite step's stop, as the loop's `halt` names it. */
export const SUITE_STEP_RED = 'suite step red';

/** A stop `start()` hands to {@link RunDecisions.atStop}. */
export type DecisionStop =
  | {
    /** A clean exit held: by its report, by what it left behind, or by a refused commit. */
    readonly kind: 'clean-exit';
    readonly taskInfo: TaskInfo;
    readonly finished: Pick<FinishedTask, 'attempt' | 'holds'>;
    /** The stop's own event, emitted only when the run stops. */
    readonly stopEvent: LoopEvent;
  }
  | {
    /** A task session that exited nonzero, past its budget and an interrupt. */
    readonly kind: 'session-exit';
    readonly taskInfo: TaskInfo;
    readonly exitCode: number;
    readonly stopEvent: LoopEvent;
  }
  | {
    /** A red suite step, not stopped by SIGINT; the task is the line it blocked. */
    readonly kind: 'suite-red';
  };

/** What {@link createRunDecisions} needs, each as `start()` settled it. */
export interface RunDecisionsOptions {
  /** What the line asks of `--continue` (`./continue-args.ts`). */
  readonly continueArgs: ContinueArgs;
  /** The project root the criteria path is read from. */
  readonly repoRoot: string;
  /** The checkout the decision session runs in. */
  readonly checkout: string;
  /** The plan's tracker, read at each decision and written by a `retry`. */
  readonly trackerPath: string;
  /** The plan's path, as the prompt names it. */
  readonly planPath: string;
  /** The criteria keys. */
  readonly settings: Pick<RafaConfig, 'loopContinueCriteria' | 'loopContinueCriteriaMode'>;
  /** The setting sources the decision session loads. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The run's record, written each time the pass-over list changes. */
  readonly session: Pick<RunSession, 'decisionsChanged'>;
  /** The run's retries: a `retry` spends one, and a retry-safe stop is decided once they are spent. */
  readonly retries: Pick<RunRetries, 'retry' | 'left' | 'lastRefusal'>;
  /** True once the run has received SIGINT. */
  readonly isInterrupted: () => boolean;
  /** The list the run opens with: the plan's newest stopped run's. */
  readonly seed: PassOverList;
  /** The decision session's spawner; `spawnClaudeCaptured` when left out. */
  readonly spawn?: CapturingSpawner;
}

/** The run's decisions; see the module note. */
export interface RunDecisions {
  /** The zero-based lines `findNextTask` skips in `trackerContent`. */
  readonly skipLines: (trackerContent: string) => ReadonlySet<number>;
  /**
   * Decides at `stop` when the module note says so: true when the loop
   * goes on, false when it halts as before (the caller emits the stop's
   * event). Throws `LoopEnd` when the decision ends the run.
   */
  readonly atStop: (stop: DecisionStop) => Promise<boolean>;
  /** Notes that `taskInfo` is done, releasing what waited on it. */
  readonly taskDone: (taskInfo: TaskInfo) => void;
  /** Ends the run with `LoopEnd` when passed-over tasks are left open in `trackerContent`. */
  readonly atPlanEnd: (trackerContent: string) => void;
}

/** No line skipped. */
const NO_LINES: ReadonlySet<number> = new Set();

/** The decisions of a run without `--continue`: none. */
const NO_DECISIONS: RunDecisions = Object.freeze({
  skipLines: () => NO_LINES,
  atStop: () => Promise.resolve(false),
  taskDone: () => undefined,
  atPlanEnd: () => undefined,
});

/** The subject of one decision: the task, why it stopped, and the event its stop emits. */
interface DecisionSubject {
  readonly taskInfo: TaskInfo;
  readonly holds: readonly string[];
  readonly stopEvent: LoopEvent;
}

/** When a stop is decided: at once, once the retries are spent, or never. */
type DecisionWhen = 'now' | 'spent' | 'never';

/** When `stop` is decided; see the module note. */
function whenOf(stop: DecisionStop): DecisionWhen {
  if (stop.kind !== 'clean-exit') return 'spent';
  if (stop.finished.attempt.outcome === 'failed') return 'never';
  return heldOnNothingLeftBehind(stop.finished)
    ? 'spent'
    : 'now';
}

/** A tracker line counted from 1, as the prompt and the events show it. */
function shownLine(taskInfo: Pick<TaskInfo, 'lineNum'>): number {
  return taskInfo.lineNum + 1;
}

/** The decisions of one run; see the module note. */
export function createRunDecisions(options: RunDecisionsOptions): RunDecisions {
  if (!options.continueArgs.on) return NO_DECISIONS;
  const { trackerPath, retries, session } = options;

  let list: PassOverList = options.seed;
  const deferred = new Set<string>();
  const passedOver = new Set<string>();
  if (list.length > 0) {
    session.decisionsChanged(list);
    activeOutput().info(`⏭  Passing over ${list.length} task(s) the plan's last stopped --continue run passed over, while they stay open.`);
  }

  const readTracker = (): string => readFileSync(trackerPath, 'utf8');
  const skipLines = (trackerContent: string): ReadonlySet<number> => skippedLines(list, trackerContent);

  const subjectOf = (stop: DecisionStop): DecisionSubject | null => {
    if (stop.kind === 'clean-exit') return { taskInfo: stop.taskInfo, holds: stop.finished.holds, stopEvent: stop.stopEvent };
    if (stop.kind === 'session-exit') {
      return { taskInfo: stop.taskInfo, holds: [`session exited ${stop.exitCode}`], stopEvent: stop.stopEvent };
    }
    const content = readTracker();
    const blocked = findNextTask(content, { skipLines: skipLines(content) });
    if (blocked?.status !== 'blocked') return null;
    return {
      taskInfo: blocked,
      holds: [blocked.blocker ?? SUITE_STEP_RED],
      stopEvent: { kind: 'halt', reason: SUITE_STEP_RED },
    };
  };

  const stopWith = (decision: ContinueDecision, subject: DecisionSubject): never => {
    const line = shownLine(subject.taskInfo);
    emitLoopEvent({ kind: 'decision', strategy: 'stop', line, reason: decision.reason });
    emitLoopEvent(subject.stopEvent);
    throw new LoopEnd(DECISION_STOP_EXIT, `⛔ The --continue decision on line ${line} is stop: ${decision.reason}`);
  };

  /** A session's decision on `subject`, or null when SIGINT ended the session. */
  const sessionDecision = async (subject: DecisionSubject, content: string): Promise<ContinueDecision | null> => {
    const criteria = resolveContinueCriteria({
      root: options.repoRoot,
      path: options.settings.loopContinueCriteria,
      mode: options.settings.loopContinueCriteriaMode,
    });
    if (!criteria.ok) return { strategy: 'stop', reason: `the criteria cannot be read, so the run stops: ${criteria.refusal}` };
    const prompt = buildDecisionPrompt({
      plan: options.planPath,
      task: subject.taskInfo,
      holds: subject.holds,
      retriesLeft: retries.left(),
      openTasks: listOpenTasks(content),
      criteria: criteria.criteria,
    });
    activeOutput().info(`\n🧭 Deciding how the run goes on after the stop on line ${shownLine(subject.taskInfo)}: one read-only session (--continue).`);
    const answer = await runDecisionSession({
      prompt,
      settingSources: options.settingSources,
      checkout: options.checkout,
      ...(options.spawn === undefined
        ? {}
        : { spawn: options.spawn }),
    });
    if (options.isInterrupted()) return null;
    if (answer.exitCode !== 0) {
      return { strategy: 'stop', reason: `the decision session exited ${answer.exitCode}, so the run stops` };
    }
    return parseDecision(answer.stdout);
  };

  /** `decision` under the run's two bounds; see the module note. */
  const bounded = (decision: ContinueDecision, identity: string): ContinueDecision => {
    const passing = decision.strategy === 'jump' || decision.strategy === 'defer';
    if (passing && passedOver.has(identity)) {
      return { strategy: 'stop', reason: `the task was passed over once already in this run and stopped again, so the run stops: ${decision.reason}` };
    }
    if (decision.strategy === 'defer' && deferred.has(identity)) {
      return { strategy: 'jump', reason: `the task was deferred once already in this run, so it is passed over as a jump: ${decision.reason}` };
    }
    return decision;
  };

  const passOver = (decision: ContinueDecision, subject: DecisionSubject, content: string, identity: string): true => {
    const line = shownLine(subject.taskInfo);
    list = addDecision(list, subject.taskInfo, decision, content);
    session.decisionsChanged(list);
    if (decision.strategy === 'defer') deferred.add(identity);
    else passedOver.add(identity);
    emitLoopEvent({ kind: 'decision', strategy: decision.strategy, line, reason: decision.reason });
    const how = decision.strategy === 'defer'
      ? `deferred until line ${String(decision.after)} is done`
      : 'passed over for the rest of this run';
    activeOutput().warn(`⏭  Line ${line} is ${how}: ${decision.reason}`);
    return true;
  };

  const retryWith = (decision: ContinueDecision, subject: DecisionSubject): boolean => {
    if (retries.left() === 0) {
      return stopWith({ strategy: 'stop', reason: `retry was chosen with no retry left, so the run stops: ${decision.reason}` }, subject);
    }
    const line = shownLine(subject.taskInfo);
    emitLoopEvent({ kind: 'decision', strategy: 'retry', line, reason: decision.reason });
    activeOutput().warn(`🔁 Line ${line} is retried with a new approach: ${decision.reason}`);
    writeTrackerBlocker(trackerPath, subject.taskInfo.lineNum, decision.approach ?? '');
    return retries.retry('the decision chose retry');
  };

  const apply = (decision: ContinueDecision, subject: DecisionSubject, content: string, identity: string): boolean => {
    switch (decision.strategy) {
      case 'retry':
        return retryWith(decision, subject);
      case 'stop':
        return stopWith(decision, subject);
      case 'jump':
      case 'defer':
        return passOver(decision, subject, content, identity);
    }
  };

  const decide = async (subject: DecisionSubject): Promise<boolean> => {
    const content = readTracker();
    const decision = await sessionDecision(subject, content);
    if (decision === null) return false;
    const identity = taskIdentity(subject.taskInfo.task);
    return apply(bounded(decision, identity), subject, content, identity);
  };

  const atStop = async (stop: DecisionStop): Promise<boolean> => {
    if (options.isInterrupted()) return false;
    const when = whenOf(stop);
    if (when === 'never') return false;
    const refusal: RetryRefusal | null = retries.lastRefusal();
    if (when === 'spent' && refusal !== 'spent') return false;
    const subject = subjectOf(stop);
    return subject === null
      ? false
      : decide(subject);
  };

  const taskDone = (taskInfo: TaskInfo): void => {
    const next = markDone(list, taskInfo);
    if (next.length === list.length) return;
    list = next;
    session.decisionsChanged(list);
  };

  const atPlanEnd = (trackerContent: string): void => {
    const left = remaining(list, trackerContent);
    if (left.length === 0) return;
    const tasks: PassedOverTask[] = left.map((entry) => ({
      line: entry.task.lineNum + 1,
      text: entry.task.task,
      strategy: entry.strategy,
      reason: entry.reason,
    }));
    activeOutput().warn('\n⏭  Every task left is one this run passed over; no wrap-up runs and no pull request is opened:');
    for (const task of tasks) activeOutput().warn(`   line ${task.line} (${task.strategy}): ${task.text}\n      ${task.reason}`);
    emitLoopEvent({ kind: 'passed-over', tasks });
    emitLoopEvent({ kind: 'halt', reason: `passed over ${tasks.length} task(s)` });
    throw new LoopEnd(PASSED_OVER_EXIT, `⏭  The run ended with ${tasks.length} passed-over task(s) left open. Run again with --continue once they can go on, or with --force-wrap-up to open a draft pull request.`);
  };

  return { skipLines, atStop, taskDone, atPlanEnd };
}
