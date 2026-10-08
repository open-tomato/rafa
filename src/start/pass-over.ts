/**
 * The pass-over list of a `rafa loop start --continue` run: the tasks a
 * decision jumped or deferred, which the run goes on past while the
 * tracker keeps their lines as they are.
 *
 * ## The list
 *
 * A list is a readonly array of {@link PassOverEntry}, and every
 * function here answers a new one, never editing the list it is handed,
 * so the run can hold each step's list as a value and save it whole on
 * its run record.
 *
 *   - A `jump` entry passes over its task for the rest of the run. The
 *     line stays `[BLOCKED]`, so a later run meets it again.
 *   - A `defer` entry passes over its task until the task it waits on is
 *     done, then the task is eligible again. A defer whose `after` names
 *     no open task, the task itself included, adds no entry: the design
 *     makes such a task eligible at once.
 *   - A `retry` or `stop` adds nothing, and any decision on a task
 *     replaces the entry an earlier decision left for it.
 *
 * ## Task identity
 *
 * Line numbers shift: the loop inserts a repair task above a red step,
 * and a later run reads a tracker other runs have edited. So an entry
 * names its task by {@link taskRefIn}: the task's text with its blocker
 * comment and its declaration off ({@link taskIdentity}), which is the
 * sentence a person wrote and nothing the loop writes onto the line,
 * and its ordinal, which copy of that text it is among the tracker's
 * task lines, ticked ones included, counted from 1 in tracker order. A
 * plan that repeats a task ("Run the suite" as a gate after each stage)
 * holds two tasks the text alone cannot tell apart; the ordinal can,
 * and since ticked lines are counted, ticking one copy renumbers no
 * other. A line of another text inserted anywhere moves no ordinal. An
 * entry saved before the ordinal existed reads as the first copy. The
 * recorded line is a hint, never the key.
 *
 * ## Reading the tracker
 *
 * Whether an entry still passes over its task is read from the tracker
 * each time, never from the list alone: {@link skippedLines} skips a
 * jumped task while it is open, and a deferred one while the task it
 * waits on is open too, so a defer is released the moment its `after`
 * is ticked, whether or not {@link markDone} was called. `markDone`
 * drops what a done task releases from the list itself, so the saved
 * list does not carry entries nothing will read again.
 */
import type { ContinueDecision } from './decision-parse.js';
import type { TaskInfo, TrackerTask } from '../utils/tracker.js';

import { stripTaskDeclaration } from '../utils/declaration.js';
import { listOpenTasks, listTrackerTasks, splitBlockerComment } from '../utils/tracker.js';

/** A task as an entry names it: its identity and the line it was last read at. */
export interface TaskRef {
  /** Zero-based, as `TaskInfo.lineNum`; a hint, see the module note. */
  readonly lineNum: number;
  /** {@link taskIdentity} of the task's text. */
  readonly task: string;
  /** Which copy of `task` it is, counted from 1; see the module note. Read as 1 when left out. */
  readonly ordinal?: number;
}

/** The strategies that pass over a task. */
export type PassOverStrategy = 'jump' | 'defer';

/** One task the run passes over. */
export interface PassOverEntry {
  readonly task: TaskRef;
  readonly strategy: PassOverStrategy;
  /** The decision's reason, which the end-of-run summary quotes. */
  readonly reason: string;
  /** `defer` only: the task to run first. */
  readonly after?: TaskRef;
}

/** A run's pass-over list. */
export type PassOverList = readonly PassOverEntry[];

/** The list a run opens with. */
export const EMPTY_PASS_OVER: PassOverList = Object.freeze([]);

/** A task as {@link addDecision} and {@link markDone} take it. */
export type PassOverTask = Pick<TaskInfo, 'task' | 'lineNum'>;

/** A task's identity: its text with its blocker comment and declaration off, trimmed. */
export function taskIdentity(text: string): string {
  return stripTaskDeclaration(splitBlockerComment(text.trim()).text).trim();
}

/** The copy of its text `ref` names, 1 for a reference saved without one. */
function ordinalOf(ref: TaskRef): number {
  return ref.ordinal ?? 1;
}

/** True when `a` and `b` name the same task: the same text, the same copy. */
function sameTask(a: TaskRef, b: TaskRef): boolean {
  return a.task === b.task && ordinalOf(a) === ordinalOf(b);
}

/**
 * The reference an entry keeps for `task` in `trackerContent`: its
 * identity and its ordinal among the task lines holding that text.
 */
export function taskRefIn(task: PassOverTask, trackerContent: string): TaskRef {
  const identity = taskIdentity(task.task);
  const copies = listTrackerTasks(trackerContent)
    .filter((line) => line.lineNum <= task.lineNum && taskIdentity(line.task) === identity);
  return { lineNum: task.lineNum, task: identity, ordinal: Math.max(1, copies.length) };
}

/** The task line `ref` names among `tasks`, whatever its status, or null. */
function locate(ref: TaskRef, tasks: readonly TrackerTask[]): TrackerTask | null {
  const copies = tasks.filter((task) => taskIdentity(task.task) === ref.task);
  return copies[ordinalOf(ref) - 1] ?? null;
}

/** `ref` at the line `task` holds it at now. */
function movedTo(ref: TaskRef, task: TrackerTask): TaskRef {
  return { lineNum: task.lineNum, task: ref.task, ordinal: ordinalOf(ref) };
}

/** The task line `ref` names while it is still open, or null. */
function locateOpen(ref: TaskRef, tasks: readonly TrackerTask[]): TrackerTask | null {
  const found = locate(ref, tasks);
  return found === null || found.status === 'done'
    ? null
    : found;
}

/** `entry` at its current lines while it still passes over its task, or null. */
function stillPassedOver(entry: PassOverEntry, tasks: readonly TrackerTask[]): PassOverEntry | null {
  const task = locateOpen(entry.task, tasks);
  if (task === null) return null;
  const moved = { ...entry, task: movedTo(entry.task, task) };
  if (entry.after === undefined) return moved;
  const after = locateOpen(entry.after, tasks);
  return after === null
    ? null
    : { ...moved, after: movedTo(entry.after, after) };
}

/**
 * `list` with `decision` on `task` recorded: a `jump` or a `defer` adds
 * an entry, replacing any earlier one for the task; a `retry` or `stop`
 * drops that earlier one alone. `decision.after` counts from one, as
 * the prompt shows lines, and is matched against `trackerContent`.
 */
export function addDecision(
  list: PassOverList,
  task: PassOverTask,
  decision: ContinueDecision,
  trackerContent: string,
): PassOverList {
  const ref = taskRefIn(task, trackerContent);
  const others = list.filter((entry) => !sameTask(entry.task, ref));
  const { strategy, reason } = decision;

  if (strategy === 'jump') return [...others, { task: ref, strategy, reason }];
  if (strategy !== 'defer' || decision.after === undefined) return others;

  const afterLine = decision.after - 1;
  const target = listOpenTasks(trackerContent)
    .find((open) => open.lineNum === afterLine && open.lineNum !== task.lineNum);
  return target === undefined
    ? others
    : [...others, { task: ref, strategy, reason, after: taskRefIn(target, trackerContent) }];
}

/**
 * `list` once `task` is done, named in `trackerContent`: its own entry
 * dropped, and every defer waiting on it released.
 */
export function markDone(list: PassOverList, task: PassOverTask, trackerContent: string): PassOverList {
  const done = taskRefIn(task, trackerContent);
  const waitsOnDone = (entry: PassOverEntry): boolean => entry.after !== undefined && sameTask(entry.after, done);
  return list.filter((entry) => !sameTask(entry.task, done) && !waitsOnDone(entry));
}

/**
 * The zero-based lines `findNextTask` skips for `list` in
 * `trackerContent`: each passed-over task still open, at its current
 * line.
 */
export function skippedLines(list: PassOverList, trackerContent: string): ReadonlySet<number> {
  return new Set(remaining(list, trackerContent).map((entry) => entry.task.lineNum));
}

/**
 * The entries still passing over an open task in `trackerContent`, in
 * list order, each at its current lines: what an end-of-run summary
 * lists and a run record saves.
 */
export function remaining(list: PassOverList, trackerContent: string): PassOverList {
  if (list.length === 0) return EMPTY_PASS_OVER;
  const tasks = listTrackerTasks(trackerContent);
  return list.flatMap((entry) => stillPassedOver(entry, tasks) ?? []);
}
