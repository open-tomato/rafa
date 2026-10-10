/**
 * `rafa plan list`: every plan under the configured plans directory, with
 * how far the loop has got through each.
 *
 * ## What is listed
 *
 * Each file in the configured plans directory named `PLAN-<stub>.md`
 * whose stub a plan stamp can carry (`../../plan/plan-files.ts`), in stub
 * order. A tracker is never listed on its own, nor is a bare `PLAN.md`,
 * which has no stub for `rafa plan show` to name, nor anything that is
 * not a file.
 * With no plans directory the list is empty, which is no refusal.
 *
 * A plan's tasks are counted from its tracker, `PLAN_TRACKER-<stub>.md`,
 * when there is one, since that is the copy the loop ticks, and from the
 * plan otherwise. Its issues are the ones `parsePlan` reports for the plan
 * itself: the file `rafa loop start` announces them for, and the one
 * `rafa plan validate` checks.
 *
 * The directory is `plan.dir` resolved against the project root the
 * dispatcher found, `.rafa/plans` unless a config names another
 * (`plan-files.ts`), and a config `loadConfig` refuses is refused with
 * exit code 1.
 *
 * ## What it writes
 *
 * In json mode the list is the terminal result's `data`: `dir`, the
 * directory read and absolute, and `plans`, each with its `stub`, its
 * `plan` and `tracker` paths, absolute and `tracker` null without one,
 * its task counts under `tasks`, and its number of `issues`. In text
 * mode it writes the header naming the directory as `plan.dir` spells
 * it, then one row per plan, the stubs padded to one column, then the
 * counts, `no tracker` for a plan with none and the issues when there
 * are any; or the header naming the directory with no plans listed.
 *
 * ## `--open`
 *
 * With `--open` only the plans {@link openPlans} keeps are listed: a plan
 * with a task still open, or with issues whatever its counts, since a
 * plan the parser misread may hold work its counts miss. A plan whose
 * remaining tasks are all `[BLOCKED]` and that has no issues is hidden,
 * as is a plan with no tasks. `listPlans` itself still returns every
 * plan, so `plan show` reads the full list. In json mode `data.plans`
 * holds only the kept plans; in text mode a directory with plans but none
 * kept writes `No plan in <dir>/ has open tasks.`, told apart from a
 * directory with no plans at all by the caller rather than by the empty
 * array.
 *
 * `--open` takes no value: a value typed onto it is refused with exit
 * code 1 (`readSwitch`, `plan-files.ts`).
 *
 * The command declares no argument and the one flag `open`, and refuses
 * a line handing it an argument with exit code 1.
 */
import type { RafaCommand } from '../../cli/command.js';
import type { PlansDir, TaskCounts } from '../../plan/plan-files.js';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePlan } from '../../plan/index.js';
import {
  countTasks,
  formatCounts,
  isFile,
  planFileName,
  plural,
  stubOfPlanFile,
} from '../../plan/plan-files.js';

import {
  expectNoArgument,
  readSwitch,
  requireProject,
  resolvePlansDir,
} from './plan-files.js';

/** The usage line a refusal names, which is also how a refusal names the command. */
const USAGE = 'rafa plan list';

/** What a refusal of a value read into `--open` says to do instead. */
const OPEN_HINT = 'Type it bare: rafa plan list --open';

/** One plan the list holds. */
export interface PlanListing {
  /** The stub its file name carries. */
  readonly stub: string;
  /** The plan, absolute. */
  readonly plan: string;
  /** Its tracker, absolute, or null when there is none. */
  readonly tracker: string | null;
  /** Its tasks, counted from the tracker when there is one. */
  readonly tasks: TaskCounts;
  /** How many issues `parsePlan` reports for the plan. */
  readonly issues: number;
}

/** Every plan under the configured plans directory. */
export interface PlanList {
  /** The directory read, absolute. */
  readonly dir: string;
  /** The plans, in stub order. */
  readonly plans: readonly PlanListing[];
}

/** One plan's listing; see the module note. */
function listing(dir: string, stub: string): PlanListing {
  const plan = join(dir, planFileName(stub, false));
  const trackerPath = join(dir, planFileName(stub, true));
  const tracker = isFile(trackerPath)
    ? trackerPath
    : null;
  const planModel = parsePlan(readFileSync(plan, 'utf8'));
  const counted = tracker === null
    ? planModel
    : parsePlan(readFileSync(tracker, 'utf8'));
  return { stub, plan, tracker, tasks: countTasks(counted.tasks), issues: planModel.issues.length };
}

/** Every plan in `plans`, the configured plans directory; see the module note. */
export function listPlans(plans: PlansDir): PlanList {
  const dir = plans.path;
  if (!existsSync(dir)) return { dir, plans: [] };
  const stubs = readdirSync(dir)
    .filter((name) => isFile(join(dir, name)))
    .map((name) => stubOfPlanFile(name))
    .filter((stub): stub is string => stub !== null)
    .sort((a, b) => a.localeCompare(b));
  return { dir, plans: stubs.map((stub) => listing(dir, stub)) };
}

/** Whether `--open` keeps a plan: a task still open, or any issue; see the module note. */
function isOpen(plan: PlanListing): boolean {
  return plan.tasks.open > 0 || plan.issues > 0;
}

/** The plans of `list` with a task still open or with issues, in the same order; see the module note. */
export function openPlans(list: PlanList): PlanList {
  return { dir: list.dir, plans: list.plans.filter(isOpen) };
}

/** What a row carries after its stub. */
function rowNotes(plan: PlanListing): string {
  const notes = [formatCounts(plan.tasks)];
  if (plan.tracker === null) notes.push('no tracker');
  if (plan.issues > 0) notes.push(plural(plan.issues, 'issue'));
  return notes.join('; ');
}

/**
 * The lines text mode writes for a list, its paths opening with
 * `dirLabel`, `plan.dir` as the config spells it. `openOnly` says the
 * list is {@link openPlans} of another, so an empty one reads as none
 * open rather than none at all; see the module note.
 */
export function renderPlanList(list: PlanList, dirLabel: string, openOnly = false): string[] {
  const label = `${dirLabel}/`;
  if (list.plans.length === 0) {
    return [openOnly
      ? `No plan in ${label} has open tasks.`
      : `No plans in ${label}.`];
  }
  const width = Math.max(...list.plans.map((plan) => plan.stub.length));
  return [`Plans in ${label}:`, ...list.plans.map((plan) => `  ${plan.stub.padEnd(width)}   ${rowNotes(plan)}`)];
}

/** The command; see the module note. */
const planListCommand: RafaCommand = {
  name: 'plan list',
  subject: 'plan',
  action: 'list',
  summary: 'list the plans, with the tasks done in each',
  description: 'Lists each `PLAN-<stub>.md` in the plans directory `plan.dir` names, in stub'
    + ' order, with its tasks counted by checkbox: from its tracker, `PLAN_TRACKER-<stub>.md`, once'
    + ' there is one, and from the plan itself before then. A plan with no tracker is marked `no'
    + ' tracker`, and a plan the plan parser did not read as written shows how many issues `rafa plan'
    + ' validate` reports for it. The directory is read under the project root, and is `.rafa/plans`'
    + ' unless a config names another. With `--open` only the plans with a task still open, or with'
    + ' issues, are listed. With `--output=json` the list is the data of the terminal result'
    + ' event, each path absolute.',
  args: [],
  flags: [
    {
      name: 'open',
      description: 'Lists only the plans with a task still open, or with issues; takes no value.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa plan list',
      note: 'Prints one row per plan: its stub, then its tasks done, blocked and open.',
    },
    {
      cmd: 'rafa plan list --open',
      note: 'Prints only the plans with open tasks or issues, hiding the done and all-blocked ones.',
    },
    {
      cmd: 'rafa plan list --output=json',
      note: 'Writes a start event, then a result event whose data is the list.',
    },
  ],
  outputs: ['text', 'json'],
  run: async (context) => {
    const openOnly = readSwitch('open', context.flags['open'], OPEN_HINT);
    expectNoArgument(context.args, USAGE);
    const plans = resolvePlansDir(requireProject(context, USAGE), USAGE, (message) => {
      context.output.warn(message);
    });
    const all = listPlans(plans);
    const list = openOnly
      ? openPlans(all)
      : all;
    if (context.outputMode === 'json') {
      context.output.result(list);
      return;
    }
    for (const line of renderPlanList(list, plans.label, openOnly)) context.output.info(line);
  },
};

export default Object.freeze(planListCommand);
