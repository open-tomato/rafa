/**
 * What `rafa plan list`, `rafa plan show` and `rafa plan validate` share:
 * where a plan and its tracker sit, a plan's tasks counted by checkbox,
 * one `parsePlan` issue as a line, and the refusal of a line handing a
 * command the wrong number of arguments.
 *
 * ## Where plans sit
 *
 * `list` and `show` read the directory {@link resolvePlansDir} answers:
 * `plan.dir` of the config that resolves for the project the dispatcher
 * found, resolved against that project's root, which is `.rafa/plans`
 * unless a config names another. That is the directory `rafa plan
 * create` writes `PLAN-<stub>.md` into and the one `rafa loop start`
 * looks for its default plan in, so the readers and the writers are on
 * one directory whatever `plan.dir` is set to. The loop keeps its copy
 * of a plan beside it as `PLAN_TRACKER-<stub>.md` (`utils/tracker.ts`)
 * and ticks that copy as tasks finish. `rafa plan validate` takes a file
 * path and reads no config, so it is on none of this.
 *
 * A {@link PlansDir} carries the two spellings a command needs: `path`,
 * absolute, is the directory read, and `label`, `plan.dir` as the config
 * spells it, is what a path a person reads opens with. A config
 * `loadConfig` refuses is refused with exit code 1, naming the command
 * and every problem.
 *
 * A stub is one a plan stamp can carry (`utils/plan-stamp.ts`): one or
 * more letters, digits, `.`, `_` and `-`. It holds no slash, so a file
 * named from one never leaves the directory.
 */
import type { RafaContext } from '../../cli/command.js';
import type { PlanIssue, PlanTask } from '../../plan/index.js';
import type { ProjectFound } from '../../project/scope.js';

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { isStampableStub } from '../../utils/plan-stamp.js';

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

/**
 * The project the dispatcher resolved for a command that declares it
 * needs one, which is every command but the three that do not.
 */
export function requireProject(context: RafaContext, command: string): ProjectFound {
  if (context.project === null) throw new Error(`${command} runs inside a project, and was handed none`);
  return context.project;
}

/**
 * Where plans sit for `project`, read off the `plan.dir` of the config
 * that resolves there; a refusal with exit code 1 naming `command` for a
 * config `loadConfig` refuses. See the module note.
 */
export function resolvePlansDir(
  project: ProjectFound,
  command: string,
  warn: (message: string) => void,
): PlansDir {
  try {
    const { config } = loadConfig({ root: project.root, home: project.home }, {}, warn);
    return plansDirAt(project.root, config.planDir);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${command}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
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
