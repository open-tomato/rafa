/**
 * The plans ingest: what the plan folder says of each plan, read through
 * core's `parsePlan` and `countTasks`, for the `plan_facts` derivation
 * (`plan_source`, `issue_number`, `tasks_planned`, `tasks_done`,
 * `tasks_blocked`) to join to the effort buckets by plan stub.
 *
 * {@link readPlans} answers one {@link PlanReading} per stub, in stub
 * order: each stub a file of the folder's top level names
 * (`PLAN-<stub>.md` or `PLAN_TRACKER-<stub>.md`, a stub a plan stamp can
 * carry), and each stub the caller hands, the plan stubs the effort
 * store holds. A stub is read from the first of these that is a file:
 *
 * - **`tracker`**, `PLAN_TRACKER-<stub>.md`, the copy the loop ticks, so
 *   its counts are how far the loop got, the rule `rafa plan list`
 *   applies;
 * - **`plan`**, `PLAN-<stub>.md`, when the plan has no tracker;
 * - **`missing`**, neither: a plan the store saw whose files are gone.
 *   Its counts and issue read null, never zero, so a metric over tasks
 *   planned leaves it out rather than reading it as an empty plan.
 *
 * `tasks` is `countTasks` over the file's tasks; a hidden task (one
 * `parsePlan` reads below the checklist) is not counted, as in
 * `rafa plan list`. `issueNumber` is the header's `issue` when it is a
 * GitHub number (`1234` or `#1234`), and null for another tracker's key
 * or none. A handed stub no plan stamp can carry (one holding a slash,
 * say) reads `missing` without a file being looked for, so no stub
 * reaches outside the folder.
 *
 * Only the folder's top level is read: a subfolder (an archive such as
 * `done/`, a plan's own notes) holds no plan the loop reads. A missing
 * folder reads every handed stub as `missing`. The folder is the
 * project's `plan.dir`, resolved by the caller; {@link DEFAULT_PLAN_DIR}
 * is core's default for it, since a module may not call core's
 * `loadConfig`. Nothing here writes: the files are only read.
 */
import type { TaskCounts } from '@open-tomato/rafa-core/core/plan';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { countTasks, isFile, isStampableStub, parsePlan, planFileName } from '@open-tomato/rafa-core/core/plan';

/** Core's default `plan.dir`, relative to the project root. */
export const DEFAULT_PLAN_DIR: string = join('.rafa', 'plans');

/** The file a plan's reading came from: `plan_facts.plan_source`. */
export type PlanSource = 'tracker' | 'plan' | 'missing';

/** What the plan folder says of one plan stub. */
export interface PlanReading {
  readonly stub: string;
  readonly source: PlanSource;
  /** The file read, absolute, or null for a `missing` plan. */
  readonly path: string | null;
  /** The header's GitHub issue, or null. */
  readonly issueNumber: number | null;
  /** The file's tasks counted by checkbox, or null for a `missing` plan. */
  readonly tasks: TaskCounts | null;
}

/** What {@link readPlans} is handed. */
export interface PlansReadOptions {
  /** The plan folder, absolute. */
  readonly planDir: string;
  /** The plan stubs the effort store holds, read as `missing` when no file names them. */
  readonly stubs?: readonly string[];
}

/** A plan's or a tracker's file name, as the folder may hold it. */
const PLAN_FILE = /^PLAN(?:_TRACKER)?-(.+)\.md$/;

/** A header `issue` naming a GitHub issue. */
const GITHUB_ISSUE = /^#?(\d+)$/;

/** The GitHub issue a header's `issue` names, or null. */
export function issueNumberOfHeader(issue: string | null): number | null {
  const digits = issue === null
    ? undefined
    : GITHUB_ISSUE.exec(issue.trim())?.[1];
  return digits === undefined
    ? null
    : Number(digits);
}

/** The stubs the folder's top-level plan and tracker files name. */
function folderStubs(planDir: string): readonly string[] {
  if (!existsSync(planDir)) return [];
  return readdirSync(planDir)
    .filter((name) => isFile(join(planDir, name)))
    .map((name) => PLAN_FILE.exec(name)?.[1])
    .filter((stub): stub is string => stub !== undefined && isStampableStub(stub));
}

/** The reading of a stub no file names. */
function missing(stub: string): PlanReading {
  return { stub, source: 'missing', path: null, issueNumber: null, tasks: null };
}

/** One stub's reading; see the module note. */
function readingOf(planDir: string, stub: string): PlanReading {
  if (!isStampableStub(stub)) return missing(stub);
  const tracker = join(planDir, planFileName(stub, true));
  const plan = join(planDir, planFileName(stub, false));
  const found: readonly [PlanSource, string] | null = isFile(tracker)
    ? ['tracker', tracker]
    : isFile(plan)
      ? ['plan', plan]
      : null;
  if (found === null) return missing(stub);
  const [source, path] = found;
  const model = parsePlan(readFileSync(path, 'utf8'));
  return { stub, source, path, issueNumber: issueNumberOfHeader(model.header.issue), tasks: countTasks(model.tasks) };
}

/** Every plan the folder holds or the store names, in stub order; see the module note. */
export function readPlans(options: PlansReadOptions): readonly PlanReading[] {
  const stubs = new Set([...folderStubs(options.planDir), ...(options.stubs ?? [])]);
  return [...stubs]
    .sort()
    .map((stub) => readingOf(options.planDir, stub));
}
