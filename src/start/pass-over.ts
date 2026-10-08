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
 * names its task by {@link taskIdentity} as well as by line: the task's
 * text with its blocker comment and its declaration off, which is the
 * sentence a person wrote and nothing the loop writes onto the line.
 * An entry is matched against the tracker's open tasks by that text,
 * and among two open tasks with the same text, by the line nearer the
 * one recorded. The recorded line is a hint, never the key.
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
import type { TaskInfo } from '../utils/tracker.js';

import { stripTaskDeclaration } from '../utils/declaration.js';
import { listOpenTasks, splitBlockerComment } from '../utils/tracker.js';

/** A task as an entry names it: its identity and the line it was last read at. */
export interface TaskRef {
  /** Zero-based, as `TaskInfo.lineNum`; a hint, see the module note. */
  readonly lineNum: number;
  /** {@link taskIdentity} of the task's text. */
  readonly task: string;
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

/** The reference an entry keeps for `task`. */
function refOf(task: PassOverTask): TaskRef {
  return { lineNum: task.lineNum, task: taskIdentity(task.task) };
}

/** The open task `ref` names now, nearest its recorded line, or null. */
function locate(ref: TaskRef, open: readonly TaskInfo[]): TaskRef | null {
  let found: TaskRef | null = null;
  for (const task of open) {
    if (taskIdentity(task.task) !== ref.task) continue;
    const nearer = found === null
      || Math.abs(task.lineNum - ref.lineNum) < Math.abs(found.lineNum - ref.lineNum);
    if (nearer) found = { lineNum: task.lineNum, task: ref.task };
  }
  return found;
}

/** `entry` at its current lines while it still passes over its task, or null. */
function stillPassedOver(entry: PassOverEntry, open: readonly TaskInfo[]): PassOverEntry | null {
  const task = locate(entry.task, open);
  if (task === null) return null;
  if (entry.after === undefined) return { ...entry, task };
  const after = locate(entry.after, open);
  return after === null
    ? null
    : { ...entry, task, after };
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
  const ref = refOf(task);
  const others = list.filter((entry) => entry.task.task !== ref.task);
  const { strategy, reason } = decision;

  if (strategy === 'jump') return [...others, { task: ref, strategy, reason }];
  if (strategy !== 'defer' || decision.after === undefined) return others;

  const afterLine = decision.after - 1;
  const target = listOpenTasks(trackerContent)
    .find((open) => open.lineNum === afterLine && open.lineNum !== task.lineNum);
  return target === undefined
    ? others
    : [...others, { task: ref, strategy, reason, after: refOf(target) }];
}

/**
 * `list` once `task` is done: its own entry dropped, and every defer
 * waiting on it released.
 */
export function markDone(list: PassOverList, task: PassOverTask): PassOverList {
  const done = taskIdentity(task.task);
  return list.filter((entry) => entry.task.task !== done && entry.after?.task !== done);
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
  const open = listOpenTasks(trackerContent);
  return list.flatMap((entry) => stillPassedOver(entry, open) ?? []);
}
