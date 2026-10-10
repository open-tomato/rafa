/**
 * One plan file read by `parsePlan`: its stages counted, its tasks
 * counted by checkbox, and every issue the parser reports. This is the
 * library half of `../commands/plan/validate.ts`, which keeps the
 * `rafa plan validate` command, its roster check, its effort-store
 * rules and everything it writes.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`, so any folder may take
 * {@link validatePlan}: `../board/gate.ts` weighs a planner's plan with
 * it when the session returned no readable review.
 *
 * ## What is read
 *
 * The one file at the absolute path handed over, and nothing else: no
 * config, no repository, no agent roster and no `PREREQUISITES` file.
 * Resolving a typed path against a working directory is the caller's.
 *
 * What is answered is what `parsePlan` reports in `PlanModel.issues`,
 * each issue carrying one `PlanIssueReason`. A task declaration's own
 * issues sit on the task, in `TaskDeclaration.issues`, not in that list,
 * and are not answered here.
 *
 * A path that is no file is refused with `CommandExit` and exit code 1,
 * which is the refusal `rafa plan validate` ends with for it.
 */
import type { PlanIssue } from './index.js';
import type { TaskCounts } from './plan-files.js';

import { readFileSync } from 'node:fs';

import { CommandExit } from '../cli/command.js';

import { countTasks, isFile } from './plan-files.js';

import { parsePlan } from './index.js';

/** A plan file read; see the module note. */
export interface PlanValidation {
  /** The file read, absolute. */
  readonly file: string;
  /** How many `# Stage:` headings it holds. */
  readonly stages: number;
  /** Its tasks, counted by checkbox. */
  readonly tasks: TaskCounts;
  /** Every issue `parsePlan` reported, in line order. */
  readonly issues: readonly PlanIssue[];
}

/** The plan at the absolute path `file`, read, or a refusal with exit code 1 when it is no file. */
export function validatePlan(file: string): PlanValidation {
  if (!isFile(file)) throw new CommandExit(1, `❌ Plan file not found: ${file}`);
  const model = parsePlan(readFileSync(file, 'utf8'));
  return { file, stages: model.stages.length, tasks: countTasks(model.tasks), issues: model.issues };
}
