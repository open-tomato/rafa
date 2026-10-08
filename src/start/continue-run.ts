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
 *   - `retry`: one retry is asked of the run's budget first. Only once
 *     it is granted is the approach written as the task's tracker blocker
 *     (`writeTrackerBlocker`), which the next dispatch hands its session,
 *     and the `decision` event emitted. A refusal leaves the tracker as
 *     the stop left it and is read as `stop`, its reason naming why: no
 *     retry left, a moved checkout, or an interrupt.
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
 * (`RunSession.decisionsChanged`), a `--force-wrap-up` run's kept on its
 * record though it ends `done`. The run opens with the list the plan's
 * newest ended run on the same branch saved
 * (`readPreviousPassOver`), handed in as {@link RunDecisionsOptions.seed},
 * less every entry whose task no longer reads `[BLOCKED]` (`seedFrom`):
 * a line a person put back to `- [ ]` is taken again, and so is one
 * ticked, edited or removed.
 *
 * ## A decision without a session
 *
 * Under `--output=json` (`activeOutputMode`) no session is spawned: the
 * stop emits `decision-needed`, holding the task, its line, why it
 * stopped, the open tasks, the retries left and the rendered prompt,
 * then the stop's own event, and the run ends with
 * {@link DECISION_NEEDED_EXIT}, the tracker as the stop left it. The
 * caller decides and starts the run again with `--continue --decide=`.
 * The events output is read by the operators as text is, and decides
 * through the session.
 *
 * A decision named on the line (`--decide`, `./continue-args.ts`) is
 * applied once, in place of the session, to the first decision point
 * the run meets. A run that opens on a `[BLOCKED]` task, the line a
 * stopped run left, meets it there, before that task is dispatched:
 * {@link RunDecisions.atFirstTask}, asked on the loop's first pass
 * alone. A run that opens on an open task keeps the directive for its
 * first stop. Either way, every later decision point decides as the
 * mode does.
 *
 * ## The end of the plan
 *
 * When `findNextTask` with the skipped lines answers no task while
 * passed-over tasks are still open, the run lists each with its
 * strategy and reason, emits `passed-over` and a `halt`, and ends with
 * {@link PASSED_OVER_EXIT}: no pre-wrap-up step, no wrap-up and no pull
 * request.
 *
 * Under `--force-wrap-up` it lists them and emits `passed-over` once,
 * and {@link RunDecisions.atPlanEnd} answers them instead: the run
 * takes its pre-wrap-up step as any run does, its one repair included,
 * and the wrap-up opens the pull request as a draft listing them
 * (`./forced-draft.ts`). A pre-wrap-up step that stops the run, red
 * after its repair, is counted ({@link RunDecisions.gateForcedWrapUp}):
 * its new failures, the baseline's inherited ones left out, within
 * `loop.forceWrapUp.maxNewFailures` (`false` tolerating none) go on to
 * the wrap-up; more, or a red step whose failures are none it can count
 * (errors outside any test, no summary), end the run with
 * {@link DECISION_STOP_EXIT} and a `halt` naming the count.
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
import type { StepOutcome } from './suite-step.js';
import type { BeforeSessionAnswer } from './suite-steps-run.js';
import type { OutputMode } from '../config-sections.js';
import type { ClaudeSettingSource, RafaConfig } from '../config.js';
import type { CapturingSpawner } from '../utils/claude.js';
import type { TaskInfo } from '../utils/tracker.js';

import { existsSync, readFileSync } from 'node:fs';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { findNextTask, listOpenTasks, writeTrackerBlocker } from '../utils/tracker.js';

import { heldOnNothingLeftBehind } from './commit.js';
import { DECISION_NEEDED_EXIT, DECISION_STOP_EXIT, LoopEnd, PASSED_OVER_EXIT } from './continue-exits.js';
import { parseDecision } from './decision-parse.js';
import { buildDecisionPrompt, resolveContinueCriteria } from './decision-prompt.js';
import { runDecisionSession } from './decision-session.js';
import { emitLoopEvent, taskPosition } from './loop-events.js';
import { addDecision, markDone, remaining, seedFrom, skippedLines, taskRefIn } from './pass-over.js';

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
  readonly settings: Pick<RafaConfig, 'loopContinueCriteria' | 'loopContinueCriteriaMode' | 'loopForceWrapUpMaxNewFailures'>;
  /** The setting sources the decision session loads. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The run's record, written each time the pass-over list changes. */
  readonly session: Pick<RunSession, 'decisionsChanged'>;
  /** The run's retries: a `retry` spends one, and a retry-safe stop is decided once they are spent. */
  readonly retries: Pick<RunRetries, 'retry' | 'left' | 'lastRefusal'>;
  /** True once the run has received SIGINT. */
  readonly isInterrupted: () => boolean;
  /** The list the plan's newest ended run saved; the run opens with the entries still `[BLOCKED]`. */
  readonly seed: PassOverList;
  /** The decision session's spawner; `spawnClaudeCaptured` when left out. */
  readonly spawn?: CapturingSpawner;
  /** The output mode, read at each decision; `activeOutputMode` when left out. */
  readonly mode?: () => OutputMode;
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
  /**
   * On the loop's first pass alone: applies a `--decide` directive to
   * `taskInfo` when it is `[BLOCKED]`, true when the loop goes on. Throws
   * `LoopEnd` for a `stop`.
   */
  readonly atFirstTask: (taskInfo: TaskInfo | null, trackerContent: string) => Promise<boolean>;
  /** Notes that `taskInfo` is done, releasing what waited on it. */
  readonly taskDone: (taskInfo: TaskInfo) => void;
  /**
   * Ends the run with `LoopEnd` when passed-over tasks are left open in
   * `trackerContent`; under `--force-wrap-up`, answers them instead.
   * Answers none when none is left open.
   */
  readonly atPlanEnd: (trackerContent: string) => readonly PassedOverTask[];
  /**
   * The answer the loop acts on after the pre-wrap-up step answered
   * `gate`: `go-on` past a red step a forced wrap-up tolerates, `gate`
   * otherwise. Throws `LoopEnd` for one it does not; see the module note.
   */
  readonly gateForcedWrapUp: (
    gate: BeforeSessionAnswer,
    forced: readonly PassedOverTask[],
    outcome: StepOutcome | null,
  ) => BeforeSessionAnswer;
}

/** No line skipped. */
const NO_LINES: ReadonlySet<number> = new Set();

/** The decisions of a run without `--continue`: none. */
const NO_DECISIONS: RunDecisions = Object.freeze({
  skipLines: () => NO_LINES,
  atStop: () => Promise.resolve(false),
  atFirstTask: () => Promise.resolve(false),
  taskDone: () => undefined,
  atPlanEnd: () => [],
  gateForcedWrapUp: (gate: BeforeSessionAnswer) => gate,
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

/**
 * The list a run opens with: the entries of `seed` whose tasks still
 * read `[BLOCKED]` (`seedFrom`), none while the tracker is not written
 * yet, and one line naming how many came back into the run.
 */
function openingList(seed: PassOverList, trackerPath: string): PassOverList {
  if (seed.length === 0) return seed;
  const kept = existsSync(trackerPath)
    ? seedFrom(seed, readFileSync(trackerPath, 'utf8'))
    : [];
  const back = seed.length - kept.length;
  if (back > 0) {
    activeOutput().info(`↩️  ${back} task(s) the last --continue run passed over no longer read [BLOCKED], so this run takes them again.`);
  }
  return kept;
}

/** The key the run's two bounds hold `taskInfo` under: its text and its ordinal (`./pass-over.ts`). */
function boundKey(taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>, trackerContent: string): string {
  const ref = taskRefIn(taskInfo, trackerContent);
  return `${String(ref.ordinal)}:${ref.task}`;
}

/** What a `retry` the run's retries refused is read as, naming the refusal. */
function refusedRetry(refusal: RetryRefusal | null): string {
  if (refusal === 'checkout moved') return 'retry was chosen, but the checkout has moved from the loop\'s last commit';
  if (refusal === 'interrupted') return 'retry was chosen, but the run was interrupted';
  return 'retry was chosen with no retry left in this run';
}

/** A tracker line counted from 1, as the prompt and the events show it. */
function shownLine(taskInfo: Pick<TaskInfo, 'lineNum'>): number {
  return taskInfo.lineNum + 1;
}

/** The decisions of one run; see the module note. */
export function createRunDecisions(options: RunDecisionsOptions): RunDecisions {
  if (!options.continueArgs.on) return NO_DECISIONS;
  const { trackerPath, retries, session } = options;

  const mode = options.mode ?? activeOutputMode;
  let directive = options.continueArgs.directive;
  let firstPass = true;
  const readTracker = (): string => readFileSync(trackerPath, 'utf8');
  let list: PassOverList = openingList(options.seed, trackerPath);
  const deferred = new Set<string>();
  const passedOver = new Set<string>();
  if (list.length > 0) {
    session.decisionsChanged(list);
    activeOutput().info(`⏭  Passing over ${list.length} task(s) the plan's last --continue run passed over, while they stay [BLOCKED].`);
  }

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

  /** The prompt for `subject`, or the `stop` criteria that cannot be read are decided as. */
  const promptFor = (subject: DecisionSubject, content: string): string | ContinueDecision => {
    const criteria = resolveContinueCriteria({
      root: options.repoRoot,
      path: options.settings.loopContinueCriteria,
      mode: options.settings.loopContinueCriteriaMode,
    });
    if (!criteria.ok) return { strategy: 'stop', reason: `the criteria cannot be read, so the run stops: ${criteria.refusal}` };
    return buildDecisionPrompt({
      plan: options.planPath,
      task: subject.taskInfo,
      holds: subject.holds,
      retriesLeft: retries.left(),
      openTasks: listOpenTasks(content),
      criteria: criteria.criteria,
    });
  };

  /** Ends a json run on `subject` with `decision-needed`; see the module note. */
  const needDecision = (subject: DecisionSubject, content: string, prompt: string): never => {
    const line = shownLine(subject.taskInfo);
    emitLoopEvent({
      kind: 'decision-needed',
      task: subject.taskInfo.task,
      line,
      holds: subject.holds,
      openTasks: listOpenTasks(content).map((task) => ({ line: shownLine(task), text: task.task })),
      retriesLeft: retries.left(),
      prompt,
    });
    emitLoopEvent(subject.stopEvent);
    throw new LoopEnd(DECISION_NEEDED_EXIT, [
      `🧭 A decision is needed for the stop on line ${line}; the decision-needed event holds its prompt.`,
      '   Run again with --continue --decide=retry|stop|jump|defer (--approach=<text> for retry, --after=<line> for defer).',
    ].join('\n'));
  };

  /** A session's decision on `prompt`, or null when SIGINT ended the session. */
  const sessionDecision = async (subject: DecisionSubject, prompt: string): Promise<ContinueDecision | null> => {
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

  /** The `--decide` directive, once: answered and then dropped, null after. */
  const takeDirective = (subject: DecisionSubject): ContinueDecision | null => {
    const taken = directive;
    if (taken === null) return null;
    directive = null;
    activeOutput().info(`\n🧭 Applying --decide=${taken.strategy}, named on the line, to line ${shownLine(subject.taskInfo)}.`);
    return taken;
  };

  /** The decision on `subject`: the directive, the json run's end, or the session's; null for an interrupt. */
  const decisionFor = async (subject: DecisionSubject, content: string): Promise<ContinueDecision | null> => {
    const directed = takeDirective(subject);
    if (directed !== null) return directed;
    const prompt = promptFor(subject, content);
    if (typeof prompt !== 'string') return prompt;
    if (mode() === 'json') needDecision(subject, content, prompt);
    return sessionDecision(subject, prompt);
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

  /** Asks the run's retries first: only a grant writes the approach and emits `retry`; a refusal stops. */
  const retryWith = (decision: ContinueDecision, subject: DecisionSubject): boolean => {
    if (!retries.retry('the decision chose retry')) {
      return stopWith({ strategy: 'stop', reason: `${refusedRetry(retries.lastRefusal())}, so the run stops: ${decision.reason}` }, subject);
    }
    const line = shownLine(subject.taskInfo);
    writeTrackerBlocker(trackerPath, subject.taskInfo.lineNum, decision.approach ?? '');
    emitLoopEvent({ kind: 'decision', strategy: 'retry', line, reason: decision.reason });
    activeOutput().warn(`🔁 Line ${line} is retried with a new approach: ${decision.reason}`);
    return true;
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
    const decision = await decisionFor(subject, content);
    if (decision === null) return false;
    const identity = boundKey(subject.taskInfo, content);
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

  const atFirstTask = async (taskInfo: TaskInfo | null, trackerContent: string): Promise<boolean> => {
    if (!firstPass) return false;
    firstPass = false;
    if (directive === null || taskInfo?.status !== 'blocked') return false;
    const stopEvent: LoopEvent = {
      kind: 'task-blocked',
      position: taskPosition(trackerContent, taskInfo.lineNum),
      reason: `--decide=${directive.strategy}`,
    };
    return decide({ taskInfo, holds: [taskInfo.blocker ?? 'blocked by an earlier run'], stopEvent });
  };

  const taskDone = (taskInfo: TaskInfo): void => {
    const next = markDone(list, taskInfo, readTracker());
    if (next.length === list.length) return;
    list = next;
    session.decisionsChanged(list);
  };

  let announced = false;
  const atPlanEnd = (trackerContent: string): readonly PassedOverTask[] => {
    const left = remaining(list, trackerContent);
    if (left.length === 0) return [];
    const tasks: PassedOverTask[] = left.map((entry) => ({
      line: entry.task.lineNum + 1,
      text: entry.task.task,
      strategy: entry.strategy,
      reason: entry.reason,
    }));
    const forcing = options.continueArgs.forceWrapUp;
    if (!announced) {
      activeOutput().warn(forcing
        ? '\n⏭  Every task left is one this run passed over; --force-wrap-up wraps up anyway, as a draft pull request listing them:'
        : '\n⏭  Every task left is one this run passed over; no wrap-up runs and no pull request is opened:');
      for (const task of tasks) activeOutput().warn(`   line ${task.line} (${task.strategy}): ${task.text}\n      ${task.reason}`);
      emitLoopEvent({ kind: 'passed-over', tasks });
      announced = true;
    }
    if (forcing) return tasks;
    emitLoopEvent({ kind: 'halt', reason: `passed over ${tasks.length} task(s)` });
    throw new LoopEnd(PASSED_OVER_EXIT, [
      `⏭  The run ended with ${tasks.length} passed-over task(s) left [BLOCKED]. A run with --continue passes them over again.`,
      '   To put a task back, mark its tracker line - [ ] and run again, or run again without --continue, which resumes the first [BLOCKED] line.',
      '   Or run again with --continue --force-wrap-up to open a draft pull request listing them.',
    ].join('\n'));
  };

  const gateForcedWrapUp = (
    gate: BeforeSessionAnswer,
    forced: readonly PassedOverTask[],
    outcome: StepOutcome | null,
  ): BeforeSessionAnswer => {
    if (gate !== 'stop' || forced.length === 0 || outcome === null || !outcome.red || outcome.interrupted) return gate;
    const max = options.settings.loopForceWrapUpMaxNewFailures;
    const tolerated = max === false
      ? 0
      : max;
    const count = outcome.step?.newFailures.length ?? 0;
    if (count > 0 && count <= tolerated) {
      activeOutput().warn(`⚠️  --force-wrap-up goes on past the red pre-wrap-up step: ${count} new failure(s), within loop.forceWrapUp.maxNewFailures ${tolerated}.`);
      return 'go-on';
    }
    const why = count === 0
      ? 'the red pre-wrap-up step holds no failure it can count (errors outside any test, or no summary)'
      : `${count} new failure(s), over loop.forceWrapUp.maxNewFailures ${String(max)}`;
    const halt = count === 0
      ? 'forced wrap-up refused: no failure to count'
      : `forced wrap-up refused: ${why}`;
    emitLoopEvent({ kind: 'halt', reason: halt });
    throw new LoopEnd(DECISION_STOP_EXIT, `⛔ --force-wrap-up refused the wrap-up: ${why}. Repair them, or raise loop.forceWrapUp.maxNewFailures.`);
  };

  return { skipLines, atStop, atFirstTask, taskDone, atPlanEnd, gateForcedWrapUp };
}
