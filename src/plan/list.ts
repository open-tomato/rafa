/**
 * The plans under a plans directory, with how far the loop has got
 * through each: the library half of `../commands/plan/list.ts`, which
 * keeps the `rafa plan list` command, its `--open` filter and its text
 * rendering.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`, so any folder may take
 * {@link listPlans}: `../next/readings.ts` reads the plans a branch
 * could continue with it, and `../status/sections.ts` types the plan it
 * shows as a {@link PlanListing}.
 *
 * ## What is listed
 *
 * Each file in the directory named `PLAN-<stub>.md` whose stub a plan
 * stamp can carry (`./plan-files.ts`), in stub order. A tracker is never
 * listed on its own, nor is a bare `PLAN.md`, which has no stub for
 * `rafa plan show` to name, nor anything that is not a file.
 * With no plans directory the list is empty, which is no refusal.
 *
 * A plan's tasks are counted from its tracker, `PLAN_TRACKER-<stub>.md`,
 * when there is one, since that is the copy the loop ticks, and from the
 * plan otherwise. Its issues are the ones `parsePlan` reports for the plan
 * itself: the file `rafa loop start` announces them for, and the one
 * `rafa plan validate` checks.
 *
 * The directory is the {@link PlansDir} the caller hands over, already
 * resolved; reading `plan.dir` off a config is the caller's.
 */
import type { PlansDir, TaskCounts } from './plan-files.js';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { countTasks, isFile, planFileName, stubOfPlanFile } from './plan-files.js';

import { parsePlan } from './index.js';

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
