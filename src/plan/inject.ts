/**
 * Rendering the part of a plan one task session is handed.
 *
 * Before modes, the loop handed every task session the WHOLE plan, and
 * the spec records what that cost on one plan: 19,808 tokens a task
 * over 36 task sessions, about 713k tokens
 * (`.rafa/specs/rafa-agent-loop-package.md`, Q6). `plan.inject` chooses how
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
 * The loop hands over the PLAN's text and the task its TRACKER
 * answered. A tracker is the plan copied once, and the two stop sharing
 * line numbers the first time a red step inserts a repair line into the
 * tracker (`insertTrackerTask`): every task below it sits one line
 * lower than the plan holds it. The task was once found by its
 * `lineNum`, so each task after a repair fell back to `full` (#865).
 * The tracker's line number is therefore never read, and
 * {@link InjectionTask} does not carry it. The task is found by what
 * the two documents share, in this order:
 *
 *   1. The one plan task whose `task` equals the dispatched one.
 *   2. When SEVERAL hold that text, the one of them at
 *      {@link InjectionRequest.position}.
 *   3. When NONE holds it, the task at that position: a plan whose
 *      task was reworded after the copy still holds it in its place.
 *
 * A position counts from zero over the model's tasks, and one that is
 * absent, negative or no integer names no task. A text held once is
 * taken whatever the position says.
 *
 * What is left falls back to `full`, which hands the session everything
 * it had before modes existed, and {@link PlanInjection.fallback} says
 * what was looked for:
 *
 *   - `no-task-with-text`: no task holds the text and none sits at the
 *     position. The plan lost the task after the copy; or the line
 *     follows the fence of a `rafa:*` block never closed, which
 *     `findNextTask` still dispatches and the model reads as that
 *     block's body. The model holds no task after such a fence, so the
 *     position of one reaches past its last task.
 *   - `several-tasks-with-text`: several tasks hold the text and the
 *     position names none of them, so nothing says which was
 *     dispatched.
 *
 * Neither is a reason to stop a plan. `full` locates nothing, so it
 * never falls back.
 *
 * ## A repair
 *
 * A repair line (`writeRepairTask`, `start/suite-blocker.ts`) exists in
 * the tracker alone, so the plan holds no task with its text and none
 * in its place. It is rendered by the plan task it names instead, which
 * the loop hands over as {@link InjectionRequest.repairs}:
 *
 *   - A repair that NAMES a task renders that task's stage. The named
 *     task is found as above, by its sentence in place of the dispatched
 *     text, with one difference: the position only settles between
 *     several tasks holding that sentence, and never stands in for a
 *     sentence no task holds. A repair's position is the place of the
 *     plan task above it, which says where it was inserted and not what
 *     it repairs. `stage` shows the repair's line open, directly below
 *     the task it names, in place of no other line: the named task and
 *     each one above it are shown done, each one below as the document
 *     wrote it. `task` shows the repair's line alone. Either way the
 *     line is the repair's sentence, its declaration off.
 *   - A repair that names a task the plan does not hold falls back to
 *     `full` with `no-task-with-text`, or `several-tasks-with-text`,
 *     and a sentence that says a repair was looking.
 *   - A repair that names NOTHING is handed the whole plan with a null
 *     fallback, whatever mode was asked for: a pre-wrap-up repair, since
 *     the whole suite is what it repairs, and every repair a tracker
 *     held before the comment was written. That is no fallback, so
 *     nothing warns.
 *
 * The plan handed over for a repair is the plan file. A tracker holds
 * its repair lines as tasks of their own, so it renders them among the
 * stage's lines and counts them in a position; the two documents render
 * the same only while the tracker holds no repair.
 *
 * Nothing here throws.
 */
import type { PlanModel, PlanTask, PlanTaskStatus } from './parse.js';
import type { InjectMode } from '../config.js';
import type { TaskInfo } from '../utils/tracker.js';

import { parseTaskDeclaration } from '../utils/declaration.js';

import { parsePlan } from './parse.js';

/**
 * The dispatched task, by the one field of `TaskInfo` it is located by.
 * Its `lineNum` is a line of the tracker and is left out on purpose.
 */
export type InjectionTask = Pick<TaskInfo, 'task'>;

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
  /**
   * The dispatched task's ordinal among the tracker's tasks, repair
   * lines not counted, from zero: its place among the plan's tasks.
   * Read only when the text does not settle the task. Absent, the text
   * alone locates it. For a repair, the place of the plan task above it.
   */
  readonly position?: number;
  /**
   * What a dispatched repair names, as `TaskInfo.repairs` holds it: the
   * sentence of a plan task, or null for a repair that names nothing.
   * Absent when the dispatched task is no repair. See the module note.
   */
  readonly repairs?: string | null;
}

/** Why a rendering fell back to `full`, by what was looked for. */
export type InjectionFallbackReason =
  /** No plan task holds the dispatched text, and none sits at its position. */
  | 'no-task-with-text'
  /** Several plan tasks hold the dispatched text, and its position names none of them. */
  | 'several-tasks-with-text';

/** Why the requested mode was not rendered. */
export interface InjectionFallback {
  /** What the lookup did not find. */
  readonly reason: InjectionFallbackReason;
  /** One sentence for an operator to read. It names no line of the plan. */
  readonly text: string;
}

/** One task's view of its plan, rendered. */
export interface PlanInjection {
  /** The mode the caller asked for. */
  readonly requested: InjectMode;
  /**
   * The mode rendered: `requested`, or `full` after a fallback and for
   * a repair that names nothing.
   */
  readonly mode: InjectMode;
  /** What the session is handed in place of the whole plan. */
  readonly text: string;
  /**
   * Why a lookup did not render `requested`, or null: when it did, and
   * for a repair that names nothing, which looks nothing up.
   */
  readonly fallback: InjectionFallback | null;
}

/** Where the dispatched task was found, or why it was not. */
type Location =
  | { readonly found: true; readonly task: PlanTask }
  | { readonly found: false; readonly fallback: InjectionFallback };

/**
 * What a rendering is built around: the plan task located, and the
 * sentence of the repair dispatched for it, or null when that task is
 * itself the one dispatched.
 */
interface Dispatched {
  readonly task: PlanTask;
  readonly repair: string | null;
}

/** Renders a located task's view of its model. */
type Renderer = (model: PlanModel, dispatched: Dispatched) => string;

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

/** How every fallback sentence ends. */
const HANDED_OVER = ', so the whole plan is handed over';

/** `position` as an index into the model's tasks, or null when it names none. */
function placeOf(position: number | undefined): number | null {
  return position !== undefined && Number.isInteger(position) && position >= 0
    ? position
    : null;
}

/** The text a fallback sentence says was looked for. */
const DISPATCHED_TEXT = 'the dispatched text';

/** {@link DISPATCHED_TEXT} when a repair was dispatched. */
const REPAIRED_TEXT = 'the text the dispatched repair names';

/** The fallback when no task holds the text and none sits at `place`. */
function noTaskWithText(place: number | null): Location {
  const beyond = place === null
    ? ''
    : ` and no task number ${place + 1}`;
  const text = `the plan holds no task with ${DISPATCHED_TEXT}${beyond}${HANDED_OVER}; `
    + 'the plan may have changed since its tracker was copied, or the task line sits inside a rafa:* block';
  return { found: false, fallback: { reason: 'no-task-with-text', text } };
}

/** The fallback when `count` tasks hold `sought` and `place` names none of them. */
function severalTasksWithText(count: number, place: number | null, sought: string): Location {
  const which = place === null
    ? 'the dispatch gives no position among its tasks'
    : `task number ${place + 1} is none of them`;
  const text = `the plan holds ${count} tasks with ${sought} and ${which}${HANDED_OVER}`;
  return { found: false, fallback: { reason: 'several-tasks-with-text', text } };
}

/** The fallback when no task holds the sentence a repair names. */
function noRepairedTask(): Location {
  const text = `the plan holds no task with ${REPAIRED_TEXT}${HANDED_OVER}; `
    + 'the plan may have changed since the repair was written';
  return { found: false, fallback: { reason: 'no-task-with-text', text } };
}

/** Finds the dispatched task in the model. See the module note. */
function locate(model: PlanModel, wanted: InjectionTask, position: number | undefined): Location {
  const place = placeOf(position);
  const atPlace = place === null
    ? undefined
    : model.tasks[place];
  const holders = model.tasks.filter((candidate) => candidate.task === wanted.task);
  const [first] = holders;

  if (first === undefined) {
    return atPlace === undefined
      ? noTaskWithText(place)
      : { found: true, task: atPlace };
  }
  if (holders.length === 1) return { found: true, task: first };
  return atPlace !== undefined && holders.includes(atPlace)
    ? { found: true, task: atPlace }
    : severalTasksWithText(holders.length, place, DISPATCHED_TEXT);
}

/** Finds the task whose sentence a repair names. See the module note. */
function locateRepaired(model: PlanModel, named: string, position: number | undefined): Location {
  const sentence = named.trim();
  const holders = model.tasks.filter((candidate) => candidate.text.trim() === sentence);
  const [first] = holders;

  if (first === undefined) return noRepairedTask();
  if (holders.length === 1) return { found: true, task: first };

  const place = placeOf(position);
  const atPlace = place === null
    ? undefined
    : model.tasks[place];
  return atPlace !== undefined && holders.includes(atPlace)
    ? { found: true, task: atPlace }
    : severalTasksWithText(holders.length, place, REPAIRED_TEXT);
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
function shownStatus(task: PlanTask, dispatched: Dispatched): PlanTaskStatus {
  if (task.lineNum < dispatched.task.lineNum) return 'done';
  if (task.lineNum > dispatched.task.lineNum) return task.status;
  return dispatched.repair === null
    ? 'unchecked'
    : 'done';
}

/** One task line: its checkbox and its text, the declaration off. */
function taskLine(status: PlanTaskStatus, task: Pick<PlanTask, 'text'>): string {
  return `${CHECKBOXES[status]} ${task.text}`;
}

/** The dispatched line, shown open: the located task's, or its repair's. */
function openLine(dispatched: Dispatched): string {
  return taskLine('unchecked', { text: dispatched.repair ?? dispatched.task.text });
}

/** `task`'s line in a stage's checklist, the repair's open line below the task it names. */
function checklistLines(task: PlanTask, dispatched: Dispatched): string[] {
  const line = taskLine(shownStatus(task, dispatched), task);
  return task === dispatched.task && dispatched.repair !== null
    ? [line, openLine(dispatched)]
    : [line];
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
function renderStage(model: PlanModel, dispatched: Dispatched): string {
  const checklist = model.tasks
    .filter((task) => task.stage === dispatched.task.stage)
    .flatMap((task) => checklistLines(task, dispatched));
  return renderDocument([
    planContextSection(model),
    stageSection(model, dispatched.task, checklist),
    stageListSection(model, dispatched.task),
  ]);
}

/** `task`: the contexts and the dispatched line alone. */
function renderTask(model: PlanModel, dispatched: Dispatched): string {
  return renderDocument([
    planContextSection(model),
    stageSection(model, dispatched.task, [openLine(dispatched)]),
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
 * to `full` when neither the task's text nor its position finds it in
 * the model, and report why. A repair is rendered by the task
 * {@link InjectionRequest.repairs} names, and one that names nothing
 * answers `full` with no fallback. See the module note for what each
 * mode renders.
 */
export function renderInjection(request: InjectionRequest): PlanInjection {
  const { mode, plan, task, position, repairs } = request;
  if (mode === 'full' || repairs === null) return { requested: mode, mode: 'full', text: plan, fallback: null };

  const model = parsePlan(plan);
  const location = repairs === undefined
    ? locate(model, task, position)
    : locateRepaired(model, repairs, position);
  if (!location.found) {
    return { requested: mode, mode: 'full', text: plan, fallback: location.fallback };
  }
  const repair = repairs === undefined
    ? null
    : parseTaskDeclaration(task.task).text.trim();
  return { requested: mode, mode, text: RENDERERS[mode](model, { task: location.task, repair }), fallback: null };
}
