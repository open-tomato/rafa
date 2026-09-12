/**
 * Rendering the part of a plan one task session is handed.
 *
 * The loop has always handed every task session the WHOLE plan, and
 * the spec records what that cost on one plan: 19,808 tokens a task
 * over 36 task sessions, about 713k tokens
 * (`.specs/rafa-agent-loop-package.md`, Q6). `plan.inject` chooses how
 * much of it a task receives instead, and {@link renderInjection}
 * renders each choice:
 *
 * | Mode | The session receives |
 * | --- | --- |
 * | `full` | the plan document, byte for byte |
 * | `stage` | the plan context, the task's stage context, that stage's checklist with earlier tasks shown as done, and the stage list |
 * | `task` | the plan context, the task's stage context, and the task line |
 *
 * `full` is what the loop did before modes existed, and it stays
 * byte-identical to that on purpose: the cutover runs a plan with
 * `full` as the one run comparable with the sibling's, so a `full`
 * rendering is the text it was given and never a re-serialisation of
 * the model. Which mode a session other than a task's gets is its
 * caller's to decide; the spec gives the wrap-up session `full`.
 *
 * ## What `stage` and `task` render
 *
 * The plan is read with {@link parsePlan}, and the rendering is built
 * from the model rather than cut out of the document:
 *
 * ```markdown
 * ## Plan context
 *
 * <the rafa:context body>
 *
 * ## Stage: <the task's stage>
 *
 * <that stage's rafa:stage-context body>
 *
 * - [x] <an earlier task in the stage>
 * - [ ] <the dispatched task>
 * - [ ] <a later task in the stage>
 *
 * ## Stages
 *
 * 1. <the task's stage> (current stage)
 * 2. <another stage>
 * ```
 *
 * `task` renders the first two sections with the dispatched task as
 * the only line. A task above every stage heading sits under
 * `## Checklist` beside the tasks that share its place, with no stage
 * context, and the stage list marks no stage for it; a plan with no
 * stage heading has no `## Stages` section. A context that is absent,
 * or holds only whitespace, has no section at all, and one that is
 * present loses its leading and trailing blank lines.
 *
 * Every part of the plan the table does not name stays out: the title,
 * the `rafa:plan` header, prose outside a block, every other stage's
 * context and tasks, and each block of a kind the model ignores. No
 * block reaches a rendering as a fence, only as the body of a context
 * the model read. No task line carries its declaration either: a line
 * is a checkbox and the model's `text`, because a declaration
 * instructs the loop and never the session, which is why
 * `buildTaskPrompt` takes it off the scoped task.
 *
 * ## Checkboxes
 *
 * A task's checkbox in a rendering is set by its place:
 *
 *   - An EARLIER task in the stage is shown done, whatever the
 *     document says. The task prompt already tells the session to
 *     treat every task above its own as completed.
 *   - The DISPATCHED task is shown open, including when the loop is
 *     resuming it from `- [BLOCKED]`.
 *   - A LATER task is shown as the document wrote it.
 *
 * The first two rules are what let a caller pass the plan or its
 * tracker and get the same text. The two documents differ only in
 * checkboxes, and the loop's own writer changes a checkbox only on the
 * task it dispatched: `findNextTask` resumes a blocked task before any
 * open one, so every line it has ticked sits above the dispatched task
 * or is that task. `inject.test.ts` walks a tracker through the loop's
 * reader and writer, a blocked resumption included, and holds the two
 * renderings equal at every dispatch.
 *
 * ## Locating the task
 *
 * The task is found by its `lineNum`, counting from zero as
 * `TaskInfo.lineNum` does, and must hold the same `task` there. A
 * tracker is the plan copied once, so a plan edited afterwards can put
 * a different task, or no task, where the tracker's task sits; and a
 * task line after the fence of a `rafa:*` block never closed is one
 * `findNextTask` still dispatches and the model reads as that block's
 * body. None of the three is a
 * reason to stop a plan. The rendering falls back to `full`, which
 * hands the session everything it had before modes existed, and says
 * why in {@link PlanInjection.fallback}. `full` locates nothing, so it
 * never falls back.
 *
 * Nothing here throws.
 */
import type { PlanModel, PlanTask, PlanTaskStatus } from './parse.js';
import type { InjectMode } from '../config.js';
import type { TaskInfo } from '../utils/tracker.js';

import { parsePlan } from './parse.js';

/** The dispatched task, by the two fields of `TaskInfo` it is located by. */
export type InjectionTask = Pick<TaskInfo, 'task' | 'lineNum'>;

/** What {@link renderInjection} renders. */
export interface InjectionRequest {
  /** How much of the plan the session is handed. */
  readonly mode: InjectMode;
  /**
   * The plan document, or its tracker: every mode but `full` renders
   * both the same. `full` answers whichever it is given.
   */
  readonly plan: string;
  /** The task being dispatched, as `findNextTask` answered it. */
  readonly task: InjectionTask;
}

/** Why a rendering fell back to `full`. */
export type InjectionFallbackReason =
  /** The model reads no task at the line: prose, a blank, or block body. */
  | 'no-task-at-line'
  /** The model reads a different task at the line. */
  | 'task-text-differs';

/** Why the requested mode was not rendered. */
export interface InjectionFallback {
  /** What the lookup found at the task's line. */
  readonly reason: InjectionFallbackReason;
  /** The task's line, counting from one, as an editor numbers it. */
  readonly line: number;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** One task's view of its plan, rendered. */
export interface PlanInjection {
  /** The mode the caller asked for. */
  readonly requested: InjectMode;
  /** The mode rendered: `requested`, or `full` after a fallback. */
  readonly mode: InjectMode;
  /** What the session is handed in place of the whole plan. */
  readonly text: string;
  /** Why `mode` is not `requested`, or null when it is. */
  readonly fallback: InjectionFallback | null;
}

/** Where the dispatched task was found, or why it was not. */
type Location =
  | { readonly found: true; readonly task: PlanTask }
  | { readonly found: false; readonly fallback: InjectionFallback };

/** Renders a located task's view of its model. */
type Renderer = (model: PlanModel, dispatched: PlanTask) => string;

/** The heading over the plan-wide context. */
const PLAN_CONTEXT_HEADING = '## Plan context';

/** The heading over a stage's context and tasks, less the stage name. */
const STAGE_HEADING_PREFIX = '## Stage: ';

/** The heading over tasks above every stage heading. */
const CHECKLIST_HEADING = '## Checklist';

/** The heading over the stage list. */
const STAGE_LIST_HEADING = '## Stages';

/** What follows the dispatched task's stage in the stage list. */
const CURRENT_STAGE_MARK = ' (current stage)';

/** A task line's checkbox, as the tracker spells each status. */
const CHECKBOXES: Readonly<Record<PlanTaskStatus, string>> = {
  unchecked: '- [ ]',
  blocked: '- [BLOCKED]',
  done: '- [x]',
};

/** The fallback for a task the model does not hold as dispatched. */
function fallbackFor(reason: InjectionFallbackReason, lineNum: number): Location {
  const line = lineNum + 1;
  const found = reason === 'no-task-at-line'
    ? 'no task the plan model reads'
    : 'a different task than the one dispatched';
  const text = `line ${line} of the plan holds ${found}, so the whole plan is handed over; `
    + 'the plan may have changed since its tracker was copied, or the line sits inside a rafa:* block';
  return { found: false, fallback: { reason, line, text } };
}

/** Finds the dispatched task in the model. See the module note. */
function locate(model: PlanModel, wanted: InjectionTask): Location {
  const task = model.tasks.find((candidate) => candidate.lineNum === wanted.lineNum);
  if (task === undefined) return fallbackFor('no-task-at-line', wanted.lineNum);
  if (task.task !== wanted.task) return fallbackFor('task-text-differs', wanted.lineNum);
  return { found: true, task };
}

/** A context body less its outer blank lines, or null when it says nothing. */
function contextBody(body: string | null): string | null {
  if (body === null || body.trim().length === 0) return null;
  return body.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
}

/** A heading and its present parts, a blank line between each. */
function section(heading: string, ...parts: readonly (string | null)[]): string {
  return [heading, ...parts]
    .filter((part): part is string => part !== null)
    .join('\n\n');
}

/** The present sections as one document ending in a newline. */
function renderDocument(sections: readonly (string | null)[]): string {
  const present = sections.filter((part): part is string => part !== null);
  return `${present.join('\n\n')}\n`;
}

/** The checkbox a task is shown with. See the module note. */
function shownStatus(task: PlanTask, dispatched: PlanTask): PlanTaskStatus {
  if (task.lineNum < dispatched.lineNum) return 'done';
  if (task.lineNum === dispatched.lineNum) return 'unchecked';
  return task.status;
}

/** One task line: its checkbox and its text, the declaration off. */
function taskLine(status: PlanTaskStatus, task: PlanTask): string {
  return `${CHECKBOXES[status]} ${task.text}`;
}

/** The plan-wide context's section, or null without a context. */
function planContextSection(model: PlanModel): string | null {
  const body = contextBody(model.context);
  return body === null
    ? null
    : section(PLAN_CONTEXT_HEADING, body);
}

/** The section of the dispatched task's place, holding `lines`. */
function stageSection(model: PlanModel, dispatched: PlanTask, lines: readonly string[]): string {
  const owner = dispatched.stage === null
    ? undefined
    : model.stages[dispatched.stage];
  if (owner === undefined) return section(CHECKLIST_HEADING, lines.join('\n'));
  return section(`${STAGE_HEADING_PREFIX}${owner.name}`, contextBody(owner.context), lines.join('\n'));
}

/** Every stage, numbered, the dispatched task's marked; null without one. */
function stageListSection(model: PlanModel, dispatched: PlanTask): string | null {
  if (model.stages.length === 0) return null;
  const items = model.stages.map((stage, index) => {
    const mark = index === dispatched.stage
      ? CURRENT_STAGE_MARK
      : '';
    return `${index + 1}. ${stage.name}${mark}`;
  });
  return section(STAGE_LIST_HEADING, items.join('\n'));
}

/** `stage`: the contexts, the stage's checklist and the stage list. */
function renderStage(model: PlanModel, dispatched: PlanTask): string {
  const checklist = model.tasks
    .filter((task) => task.stage === dispatched.stage)
    .map((task) => taskLine(shownStatus(task, dispatched), task));
  return renderDocument([
    planContextSection(model),
    stageSection(model, dispatched, checklist),
    stageListSection(model, dispatched),
  ]);
}

/** `task`: the contexts and the dispatched task's line alone. */
function renderTask(model: PlanModel, dispatched: PlanTask): string {
  return renderDocument([
    planContextSection(model),
    stageSection(model, dispatched, [taskLine('unchecked', dispatched)]),
  ]);
}

/** The renderer of every mode that reads the model. */
const RENDERERS: Readonly<Record<Exclude<InjectMode, 'full'>, Renderer>> = {
  stage: renderStage,
  task: renderTask,
};

/**
 * Renders the part of a plan the dispatched task's session is handed.
 *
 * Takes any plan text and any task, answers a new value and never
 * throws. `full` answers the plan text unchanged. `stage` and `task`
 * answer a document built from {@link parsePlan}'s model, or fall back
 * to `full` when the model does not hold the task at its line, and
 * report why. See the module note for what each mode renders.
 */
export function renderInjection(request: InjectionRequest): PlanInjection {
  const { mode, plan, task } = request;
  if (mode === 'full') return { requested: mode, mode, text: plan, fallback: null };

  const model = parsePlan(plan);
  const location = locate(model, task);
  if (!location.found) {
    return { requested: mode, mode: 'full', text: plan, fallback: location.fallback };
  }
  return { requested: mode, mode, text: RENDERERS[mode](model, location.task), fallback: null };
}
