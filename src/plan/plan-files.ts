/**
 * The plan-file readings any folder may take, the library half of
 * `../commands/plan/plan-files.ts`: the two spellings of where plans
 * sit, a plan's tasks counted by checkbox, the file a stub names and the
 * stub a file name carries, what is read as a file, one `parsePlan`
 * issue as a line, a count with its noun, and where a refused plan is
 * moved aside ({@link rejectedPath}). That last one sits here rather
 * than in `../board/gate.ts`, the module that enforces the refusal, so
 * `../commands/plan/store-check.ts` can read it without importing the
 * gate and closing a cycle back into it.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`. The command half
 * keeps what does: the project a command was handed, the config that
 * resolves for it, the argument refusals and the read of a flag taking
 * no value.
 *
 * ## Where plans sit
 *
 * A {@link PlansDir} carries the two spellings a command needs: `path`,
 * absolute, is the directory read, and `label`, `plan.dir` as the config
 * spells it, is what a path a person reads opens with. {@link plansDirAt}
 * builds one from a project root and a `plan.dir` the caller already
 * holds; the command half's `resolvePlansDir` reads that `plan.dir` off
 * the config first. `rafa plan create` writes `PLAN-<stub>.md` into the
 * directory, and the loop keeps its copy of a plan beside it as
 * `PLAN_TRACKER-<stub>.md` (`utils/tracker.ts`) and ticks that copy as
 * tasks finish.
 *
 * A stub is one a plan stamp can carry (`utils/plan-stamp.ts`): one or
 * more letters, digits, `.`, `_` and `-`. It holds no slash, so a file
 * named from one never leaves the directory.
 */
import type { PlanIssue, PlanTask } from './index.js';

import { statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { isStampableStub } from '../utils/plan-stamp.js';

/** Where the plans of one invocation sit, in the two spellings a command needs. */
export interface PlansDir {
  /** `plan.dir` as the config spells it, which is what a path a person reads opens with. */
  readonly label: string;
  /** The directory read: `label` resolved against the project root, absolute. */
  readonly path: string;
}

/** Where plans sit for a project `root` and a `planDir`, in both spellings. */
export function plansDirAt(root: string, planDir: string): PlansDir {
  return { label: planDir, path: resolve(root, planDir) };
}

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

/**
 * The directory a rejected plan is moved into: `rejected/` beside the
 * file itself, which is `<plan.dir>/rejected` for every path the caller
 * names, since the planner writes both files under `plan.dir`.
 */
export const REJECTED_DIR = 'rejected';

/**
 * Where `path` lands once a refusal moves it aside, as the report
 * names it (`../board/gate.ts`, `../commands/plan/store-check.ts`).
 */
export function rejectedPath(path: string): string {
  const parent = dirname(path);
  return parent === '.'
    ? join(REJECTED_DIR, basename(path))
    : join(parent, REJECTED_DIR, basename(path));
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
