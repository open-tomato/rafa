/**
 * What `rafa plan list`, `rafa plan show` and `rafa plan validate` share:
 * where a plan and its tracker sit, a plan's tasks counted by checkbox,
 * one `parsePlan` issue as a line, and the refusal of a line handing a
 * command the wrong number of arguments.
 *
 * ## Where plans sit
 *
 * `list` and `show` read {@link PLANS_DIR}, `.plans/` under the git root:
 * where `rafa plan create` writes `PLAN-<stub>.md`, and where
 * `rafa loop start` looks for its default plan. The loop keeps its copy
 * of a plan beside it as `PLAN_TRACKER-<stub>.md` (`utils/tracker.ts`)
 * and ticks that copy as tasks finish. The config resolves `plan.dir`,
 * which no command reads yet, so these two read the directory the phase 0
 * commands use.
 *
 * A stub is one a plan stamp can carry (`utils/plan-stamp.ts`): one or
 * more letters, digits, `.`, `_` and `-`. It holds no slash, so a file
 * named from one never leaves the directory.
 */
import type { PlanIssue, PlanTask } from '../../plan/index.js';

import { statSync } from 'node:fs';

import { CommandExit } from '../../cli/command.js';
import { isStampableStub } from '../../utils/plan-stamp.js';

/** Where plans sit, under the git root. */
export const PLANS_DIR = '.plans';

/** Answers the root of the repository a command reads: the git root, unless a test hands another. */
export type RepoRootFinder = () => string;

/** A plan's tasks, counted by checkbox. */
export interface TaskCounts {
  /** Every task line. */
  readonly total: number;
  /** Ticked, `- [x] `. */
  readonly done: number;
  /** Marked `- [BLOCKED] `. */
  readonly blocked: number;
  /** Still `- [ ] `. */
  readonly open: number;
}

/** The checkbox each status is written with in a checklist. */
const CHECKBOXES: Readonly<Record<PlanTask['status'], string>> = {
  unchecked: '[ ]',
  blocked: '[BLOCKED]',
  done: '[x]',
};

/** A plan's tasks, counted by checkbox. */
export function countTasks(tasks: readonly Pick<PlanTask, 'status'>[]): TaskCounts {
  const done = tasks.filter((task) => task.status === 'done').length;
  const blocked = tasks.filter((task) => task.status === 'blocked').length;
  return { total: tasks.length, done, blocked, open: tasks.length - done - blocked };
}

/** The counts as one phrase: `3/5 done, 1 blocked, 1 open`. */
export function formatCounts(counts: TaskCounts): string {
  return `${counts.done}/${counts.total} done, ${counts.blocked} blocked, ${counts.open} open`;
}

/** A status as the checklist writes its checkbox: `[ ]`, `[BLOCKED]` or `[x]`. */
export function checkbox(status: PlanTask['status']): string {
  return CHECKBOXES[status];
}

/** The file a stub names: `PLAN-<stub>.md`, or `PLAN_TRACKER-<stub>.md` for its tracker. */
export function planFileName(stub: string, tracker: boolean): string {
  return tracker
    ? `PLAN_TRACKER-${stub}.md`
    : `PLAN-${stub}.md`;
}

/**
 * The stub a plan's file name carries, or null for any other name: a
 * tracker's, a bare `PLAN.md`, and a stub no plan stamp can carry.
 */
export function stubOfPlanFile(name: string): string | null {
  const stub = /^PLAN-(.+)\.md$/.exec(name)?.[1];
  return stub !== undefined && isStampableStub(stub)
    ? stub
    : null;
}

/** True when `path` is a file, a link to one included. */
export function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** One issue as a line: `<file>:<line>: <reason>: <text>`, the line counting from one. */
export function issueLine(file: string, issue: PlanIssue): string {
  return `${file}:${issue.line}: ${issue.reason}: ${issue.text}`;
}

/** A count and its noun, the noun taking an `s` unless the count is 1. */
export function plural(count: number, noun: string): string {
  return count === 1
    ? `${count} ${noun}`
    : `${count} ${noun}s`;
}

/** Refuses a line handing a command reading none any argument: exit code 1, naming the words and the usage. */
export function expectNoArgument(args: readonly string[], usage: string): void {
  if (args.length === 0) return;
  throw new CommandExit(1, `❌ Expected no argument, got ${args.length}: ${args.join(' ')}\nUsage: ${usage}`);
}

/**
 * The one argument a line hands a command reading one, or a refusal with
 * exit code 1 naming what the line handed and the usage.
 */
export function expectOneArgument(args: readonly string[], usage: string): string {
  const [only] = args;
  if (args.length === 1 && only !== undefined) return only;
  const got = args.length === 0
    ? 'none'
    : `${args.length}: ${args.join(' ')}`;
  throw new CommandExit(1, `❌ Expected one argument, got ${got}\nUsage: ${usage}`);
}
