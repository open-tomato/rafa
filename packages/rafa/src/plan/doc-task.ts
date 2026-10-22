/**
 * The closing doc task a plan that changes code ends on, checked: the
 * `missing-doc-task` warning `./validate.ts` answers beside the parser's
 * issues.
 *
 * ## The rule
 *
 * A plan holding one task line NOT declared `agent=doc-updater` changes
 * code, and ends on one task declared `agent=doc-updater docs=repair`,
 * which repairs the docs of what the plan changed. A plan whose every
 * task line declares `agent=doc-updater` is prose only, and gets none.
 * A plan with no task line at all changes nothing, and is prose only
 * too. The dev-planner skill writes the rule; this module checks it.
 *
 * What is checked is the LAST task line in source order, whatever its
 * checkbox, and only its `docs=` value as `readDocsRole` reads it: a
 * last line declaring `docs=repair` passes, and one declaring no
 * `docs=`, or a value outside the one role, does not. The task lines
 * read are `PlanModel.tasks`, so a line a never-closed block hides is
 * neither counted nor taken for the last.
 *
 * ## A warning, never a refusal
 *
 * A plan written before the rule carries no doc task and still runs: the
 * finding is a {@link PlanWarning}, kept apart from `PlanIssue`, which
 * `rafa plan validate` ends with exit code 1 on. Its line is the plan's
 * last task line, counting from one as an issue's line does.
 */
import type { PlanModel, PlanTask } from '../core/plan/index.js';

import { readDocsRole } from '../core/plan/index.js';

/** The agent a prose task is declared under. */
export const DOC_AGENT = 'doc-updater';

/** Why a plan was warned about. */
export type PlanWarningReason =
  /** A plan that changes code whose last task line declares no `docs=repair`. */
  'missing-doc-task';

/** One thing a plan does that runs, but is not what the planner's rules ask for. */
export interface PlanWarning {
  /** What the plan does, and why it is warned about. */
  readonly reason: PlanWarningReason;
  /** The line it concerns, counting from one. */
  readonly line: number;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** True when `task` is declared `agent=doc-updater`. */
function isProseTask(task: PlanTask): boolean {
  return task.declaration?.agent === DOC_AGENT;
}

/** True when every task line of `tasks` is declared `agent=doc-updater`, as it is for none at all. */
export function isProseOnly(tasks: readonly PlanTask[]): boolean {
  return tasks.every(isProseTask);
}

/**
 * The `missing-doc-task` warning for `model`, as a list of none or one:
 * one when the plan holds a task not declared `agent=doc-updater` and its
 * last task line does not declare `docs=repair`; see the module note.
 */
export function docTaskWarnings(model: PlanModel): readonly PlanWarning[] {
  const last = model.tasks.at(-1);
  if (last === undefined || isProseOnly(model.tasks)) return [];
  if (readDocsRole(last.declaration) === 'repair') return [];
  return [{
    reason: 'missing-doc-task',
    line: last.lineNum + 1,
    text: 'the plan holds a task not declared `agent=doc-updater`, and its last task line'
      + ' declares no `docs=repair`: end it on one task declared `agent=doc-updater docs=repair`',
  }];
}
