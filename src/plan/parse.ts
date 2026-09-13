/**
 * The plan model: a plan document read into its header, its contexts,
 * its stages and its tasks.
 *
 * Two readers find the structure in a plan, and this module puts them
 * together without adding to either. {@link readRafaBlocks} answers the
 * fenced `rafa:*` blocks; the checklist grammar the loop has always
 * dispatched from answers the stage headings and the task lines:
 *
 * ````markdown
 * # Plan: <title>
 *
 * ```rafa:plan
 * stub: my-feature
 * issue: OPT-123
 * spec: .specs/my-feature.md
 * ```
 *
 * ```rafa:context
 * Prose for every task.
 * ```
 *
 * # Stage: schema
 *
 * ```rafa:stage-context
 * Prose for the tasks under this heading only.
 * ```
 *
 * - [ ] Add the Zod schema  {agent=loop-implementer effort=high}
 * ````
 *
 * Every block is optional. A plan carrying none is a checklist, as
 * every plan was before the format, and reads with a null header and a
 * null context. {@link parsePlan} is the whole interface: it takes any
 * string, never throws, and reports what it did not read as written in
 * {@link PlanModel.issues}.
 *
 * ## The checklist is the loop's, unchanged
 *
 * Task lines are read with the patterns `findNextTask` reads them with,
 * `- [ ] ` and `- [BLOCKED] `, and with the `- [x] ` `updateTrackerLine`
 * ticks a line to. Lines are the same `split('\n')`, and a task's text
 * is its capture trimmed, as `findNextTask` trims it. So outside a
 * `rafa:*` block never closed, a line is an open task of the model
 * exactly when `findNextTask` can dispatch it, with the same text,
 * `lineNum` and status. `parse.test.ts` measures that rather than
 * restating it: it walks whole plans through both, ticking each task
 * the dispatcher picks with the loop's own writer, and holds the two
 * in lockstep.
 *
 * A stage heading is `# Stage: <name>` at column 0: one `#`, as
 * `dev-planner` requires of a stage label, one space after the colon,
 * and the name trimmed. A task belongs to the nearest heading above it,
 * and to no stage above the first.
 *
 * A task's declaration comes off through `parseTaskDeclaration`,
 * unchanged: a task's `text` and `declaration` are that function's
 * answer for its `task`.
 *
 * ## Where the two readers disagree
 *
 * The block reader tracks fences as a renderer shows them, and the
 * checklist tracks only the closed `rafa:*` blocks among them. Two
 * rules settle the lines in between.
 *
 *   - A line inside a `rafa:*` block is that block's body and never a
 *     heading or a task, whatever it looks like: a block is the
 *     format's own unit, read whole and stripped whole. `findNextTask`
 *     skips an open task line inside a closed block too, which is what
 *     keeps a block out of every place the loop quotes a task back. It
 *     still dispatches one after the fence of a block never closed,
 *     for the reason its TSDoc gives, and that is the one place the
 *     model and the dispatcher disagree. Either way each such line is
 *     reported as a `task-in-block` issue rather than dropped in
 *     silence.
 *   - A line inside any other fence is read fence-blind, as the
 *     checklist reads it, so the model holds every task the loop can
 *     dispatch. A plan illustrating the format indents its example
 *     lines, which neither grammar reads.
 *
 * ## Blocks
 *
 * The kinds read are {@link PLAN_BLOCK_KINDS}. Every other kind — a
 * `rafa:report`, or one a later phase defines — is retained in
 * {@link PlanModel.blocks} and ignored, the rule `utils/declaration.ts`
 * applies to an unrecognised key. A header key that none of
 * {@link PLAN_HEADER_FIELDS} names is retained in
 * {@link PlanHeader.extras} for the same reason.
 *
 *   - `rafa:context` is plan-wide wherever it sits, under a stage
 *     heading included.
 *   - `rafa:stage-context` belongs to the nearest stage heading ABOVE
 *     it, before that stage's tasks or after them. One above every
 *     heading belongs to no stage, is reported, and is not read.
 *   - One block is read per place: one `rafa:plan` and one
 *     `rafa:context` per plan, one `rafa:stage-context` per stage. It
 *     is the FIRST, as the first of a duplicated declaration key wins,
 *     and each later one is reported.
 *   - A block never closed runs to the end of the document and takes
 *     every line after its fence with it. Whatever its kind, it is
 *     reported and its body is not read.
 *
 * ## The header, measured on bun 1.3.14
 *
 * `Bun.YAML.parse` reads the `rafa:plan` body. A field is usable only
 * as a string holding more than whitespace, and a stub only as one
 * `planStampLine` can stamp. Anything else leaves the field null and is
 * reported as `unusable-field`, because two spellings a plan plausibly
 * writes do not parse to what they say:
 *
 *   - `issue: #42` parses as `issue: null`, since a `#` after a space
 *     opens a YAML comment. Quoted, `"#42"` is the string.
 *   - `issue: 42` and `issue: 042` both parse as the number 42, so a
 *     number is refused rather than turned back into a string that may
 *     not be the one written.
 *
 * A body that is not YAML throws a `SyntaxError` whose message names no
 * line, and a body that is not a mapping is no header; both are
 * reported as `malformed-header`, against the block's opening fence. An
 * empty or comment-only body parses as null and says nothing. A
 * duplicated key keeps its last value and leaves no trace, so nothing
 * here can report it. {@link PlanHeader.extras} come in
 * `Object.entries` order, which puts integer-like keys first.
 *
 * ## Line numbers
 *
 * `lineNum` counts from ZERO, as `TaskInfo.lineNum` does, so a model
 * task compares directly with the one `findNextTask` handed the loop.
 * An issue's `line` counts from ONE, as an editor and a block's `span`
 * do.
 */
import type { RafaBlock } from './blocks.js';
import type { TaskDeclaration } from '../utils/declaration.js';

import { parseTaskDeclaration } from '../utils/declaration.js';
import { isStampableStub } from '../utils/plan-stamp.js';

import { readRafaBlocks } from './blocks.js';

/** The block kinds a plan is read from. Every other kind is ignored. */
export const PLAN_BLOCK_KINDS = ['plan', 'context', 'stage-context'] as const;

/** One of the three kinds a plan is read from. */
export type PlanBlockKind = (typeof PLAN_BLOCK_KINDS)[number];

/** The fields a `rafa:plan` block answers to. */
export const PLAN_HEADER_FIELDS = ['stub', 'issue', 'spec'] as const;

/** One of the three header fields. */
export type PlanHeaderField = (typeof PLAN_HEADER_FIELDS)[number];

/** One header key that names no field. */
export interface PlanHeaderExtra {
  /** The key as written. */
  readonly key: string;
  /**
   * The value exactly as the parser returned it. Never serialised
   * here: a YAML alias can make it cyclic.
   */
  readonly value: unknown;
}

/** What the `rafa:plan` block said. Every field is null without one. */
export interface PlanHeader {
  /** The plan's stub, one a plan stamp can carry. */
  readonly stub: string | null;
  /** The tracker issue the plan implements, such as `OPT-123`. */
  readonly issue: string | null;
  /** The spec the plan implements, as a path. */
  readonly spec: string | null;
  /** Every key that names no field, retained and acting on nothing. */
  readonly extras: readonly PlanHeaderExtra[];
}

/** A task line's checkbox: open, blocked, or ticked by the loop. */
export type PlanTaskStatus = 'unchecked' | 'blocked' | 'done';

/** One `# Stage:` heading. */
export interface PlanStage {
  /** The heading's text after `# Stage: `, trimmed. */
  readonly name: string;
  /** The heading's line, counting from zero. */
  readonly lineNum: number;
  /** The body of the `rafa:stage-context` block it owns, or null. */
  readonly context: string | null;
}

/** One task line. */
export interface PlanTask {
  /**
   * The line after its checkbox, trimmed, declaration included: what
   * `findNextTask` answers as `TaskInfo.task` for an open line.
   */
  readonly task: string;
  /** The line, counting from zero, as `TaskInfo.lineNum` does. */
  readonly lineNum: number;
  /** Its checkbox. */
  readonly status: PlanTaskStatus;
  /** The task sentence, any declaration taken off. */
  readonly text: string;
  /** What its trailing block declared, or null without one. */
  readonly declaration: TaskDeclaration | null;
  /**
   * The index in {@link PlanModel.stages} of the nearest heading above
   * it, or null above the first.
   */
  readonly stage: number | null;
}

/** Why part of a plan was not read as written. */
export type PlanIssueReason =
  /** A `rafa:*` block the document never closed. Not read. */
  | 'unclosed-block'
  /** A second block where one is read. The first is the one read. */
  | 'duplicate-block'
  /** A `rafa:stage-context` above every stage heading. Not read. */
  | 'orphan-stage-context'
  /** A `rafa:plan` body that is not YAML, or not a mapping. */
  | 'malformed-header'
  /** A header field whose value is not a usable string. Left null. */
  | 'unusable-field'
  /** An open task line inside a `rafa:*` block, read as its body. */
  | 'task-in-block';

/** One thing the plan said that the model does not hold as written. */
export interface PlanIssue {
  /** What went unread, and why. */
  readonly reason: PlanIssueReason;
  /**
   * The line it concerns, counting from one: the task line for
   * `task-in-block`, a block's opening fence for every other reason.
   */
  readonly line: number;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** A plan, read. */
export interface PlanModel {
  /** The `rafa:plan` fields. */
  readonly header: PlanHeader;
  /** The body of the plan-wide `rafa:context` block, or null. */
  readonly context: string | null;
  /** Every stage heading, in source order. */
  readonly stages: readonly PlanStage[];
  /** Every task line, in source order, whatever its checkbox. */
  readonly tasks: readonly PlanTask[];
  /**
   * Every `rafa:*` block, as {@link readRafaBlocks} answered it, the
   * kinds this module ignores included.
   */
  readonly blocks: readonly RafaBlock[];
  /** What was not read as written, by line. Empty for a clean plan. */
  readonly issues: readonly PlanIssue[];
}

/** The checklist's line shapes, as `utils/tracker.ts` reads and writes them. */
const TASK_LINES: readonly (readonly [PlanTaskStatus, RegExp])[] = [
  ['unchecked', /^- \[ \] (.+)/],
  ['blocked', /^- \[BLOCKED\] (.+)/],
  ['done', /^- \[x\] (.+)/],
];

/** A stage heading. The capture is its name, untrimmed. */
const STAGE_HEADING = /^# Stage: (.+)/;

/** A stage heading, before its context is bound. */
interface Heading {
  readonly name: string;
  readonly lineNum: number;
}

/** A task line's checkbox and text. */
interface TaskLine {
  readonly status: PlanTaskStatus;
  readonly task: string;
}

/** What the line-by-line pass found. */
interface Checklist {
  readonly headings: readonly Heading[];
  readonly tasks: readonly PlanTask[];
  readonly issues: readonly PlanIssue[];
}

/** The place one block is read in, and how an issue names it. */
interface Slot {
  /** One key per place a single block is read. */
  readonly key: string;
  /** The place as an issue names it, or the empty string. */
  readonly scope: string;
}

/** The blocks each place reads, once duplicates and orphans are out. */
interface BoundBlocks {
  readonly header: RafaBlock | null;
  readonly context: RafaBlock | null;
  /** Each heading's stage-context body, by heading index, or null. */
  readonly stageContexts: readonly (string | null)[];
  readonly issues: readonly PlanIssue[];
}

/** A header, and what reading it reported. */
interface HeaderReading {
  readonly header: PlanHeader;
  readonly issues: readonly PlanIssue[];
}

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** True when `kind` is one of the three a plan is read from. */
function isPlanBlockKind(kind: string): kind is PlanBlockKind {
  return (PLAN_BLOCK_KINDS as readonly string[]).includes(kind);
}

/** True when `key` names one of the three header fields. */
function isHeaderField(key: string): key is PlanHeaderField {
  return (PLAN_HEADER_FIELDS as readonly string[]).includes(key);
}

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as an issue quotes it. Never serialises a collection. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return String(value);
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** One issue. */
function planIssue(reason: PlanIssueReason, line: number, text: string): PlanIssue {
  return { reason, line, text };
}

/** A header that says nothing. */
function emptyHeader(): PlanHeader {
  return { stub: null, issue: null, spec: null, extras: [] };
}

/** The line's checkbox and text, or null when it is no task line. */
function readTaskLine(line: string): TaskLine | null {
  for (const [status, pattern] of TASK_LINES) {
    const capture = pattern.exec(line)?.[1];
    if (capture !== undefined) return { status, task: capture.trim() };
  }
  return null;
}

/** The line's stage name, or null when it is no stage heading. */
function readStageHeading(line: string): string | null {
  const capture = STAGE_HEADING.exec(line)?.[1];
  return capture === undefined
    ? null
    : capture.trim();
}

/** The block whose span covers the line at `lineNum`, if any. */
function blockAt(blocks: readonly RafaBlock[], lineNum: number): RafaBlock | undefined {
  const line = lineNum + 1;
  return blocks.find((block) => block.span.first <= line && line <= block.span.last);
}

/** The issue an open task line inside a block produces. */
function taskInBlock(lineNum: number, status: PlanTaskStatus, block: RafaBlock): PlanIssue {
  const { first, last } = block.span;
  const dispatcher = block.closed
    ? 'findNextTask skips it'
    : 'findNextTask still dispatches it, the block never being closed';
  return planIssue(
    'task-in-block',
    lineNum + 1,
    `${status} task line inside the rafa:${block.kind} block at lines ${first}-${last}: `
      + `${dispatcher}, and the model reads it as block body`,
  );
}

/**
 * Reads every stage heading and task line outside a `rafa:*` block,
 * and reports each open task line inside one.
 */
function readChecklist(markdown: string, blocks: readonly RafaBlock[]): Checklist {
  const headings: Heading[] = [];
  const tasks: PlanTask[] = [];
  const issues: PlanIssue[] = [];

  for (const [lineNum, line] of markdown.split('\n').entries()) {
    const taskLine = readTaskLine(line);
    const block = blockAt(blocks, lineNum);
    if (block !== undefined) {
      if (taskLine !== null && taskLine.status !== 'done') {
        issues.push(taskInBlock(lineNum, taskLine.status, block));
      }
      continue;
    }

    const name = readStageHeading(line);
    if (name !== null) {
      headings.push({ name, lineNum });
      continue;
    }
    if (taskLine === null) continue;

    const { text, declaration } = parseTaskDeclaration(taskLine.task);
    const stage = headings.length > 0
      ? headings.length - 1
      : null;
    tasks.push({ task: taskLine.task, lineNum, status: taskLine.status, text, declaration, stage });
  }

  return { headings, tasks, issues };
}

/** The index of the last heading above the line at `lineNum`, or null. */
function headingAbove(headings: readonly Heading[], lineNum: number): number | null {
  let above: number | null = null;
  for (const [index, heading] of headings.entries()) {
    if (heading.lineNum >= lineNum) break;
    above = index;
  }
  return above;
}

/** The slot key a stage's context is read under. */
function stageSlot(index: number): string {
  return `stage-context@${index}`;
}

/** The place `block` is read in, or null for a stage context above every heading. */
function slotOf(block: RafaBlock, headings: readonly Heading[]): Slot | null {
  if (block.kind !== 'stage-context') return { key: block.kind, scope: '' };

  const index = headingAbove(headings, block.span.first - 1);
  if (index === null) return null;
  const name = headings[index]?.name ?? '';
  return { key: stageSlot(index), scope: ` under # Stage: ${name}` };
}

/**
 * Settles which block each place reads: the first closed block of a
 * kind this module reads, per plan or per stage. Reports every block
 * never closed, every stage context above every heading, and every
 * block a place already had.
 */
function bindBlocks(blocks: readonly RafaBlock[], headings: readonly Heading[]): BoundBlocks {
  const read = new Map<string, RafaBlock>();
  const issues: PlanIssue[] = [];

  for (const block of blocks) {
    const line = block.span.first;
    if (!block.closed) {
      issues.push(planIssue(
        'unclosed-block',
        line,
        `rafa:${block.kind} block is never closed, so it runs to the end of the document `
          + 'and nothing after its fence is read',
      ));
      continue;
    }
    if (!isPlanBlockKind(block.kind)) continue;

    const slot = slotOf(block, headings);
    if (slot === null) {
      issues.push(planIssue(
        'orphan-stage-context',
        line,
        'rafa:stage-context block above every # Stage: heading belongs to no stage and is not read',
      ));
      continue;
    }

    const earlier = read.get(slot.key);
    if (earlier === undefined) {
      read.set(slot.key, block);
      continue;
    }
    issues.push(planIssue(
      'duplicate-block',
      line,
      `rafa:${block.kind} block${slot.scope} repeats the one at line ${earlier.span.first}, `
        + 'which is the one read',
    ));
  }

  return {
    header: read.get('plan') ?? null,
    context: read.get('context') ?? null,
    stageContexts: headings.map((_, index) => read.get(stageSlot(index))?.body ?? null),
    issues,
  };
}

/** The field's value when it is usable, else null. See the module note. */
function usableField(field: PlanHeaderField, value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  if (field === 'stub' && !isStampableStub(value)) return null;
  return value;
}

/** Why a field's value is not usable, for an operator to read. */
function unusableText(field: PlanHeaderField, value: unknown): string {
  const subject = `rafa:plan ${field}`;
  if (value === null) {
    return `${subject} is empty; a value opening with # after a space is a YAML comment unless quoted`;
  }
  if (typeof value !== 'string') {
    return `${subject} is ${describeValue(value)}, not a string; quote it`;
  }
  if (value.trim().length === 0) return `${subject} is blank`;
  return `${subject} ${JSON.stringify(value)} is no stub a plan stamp can carry `
    + '(letters, digits, ".", "_" and "-")';
}

/** Reads the header fields out of a parsed `rafa:plan` body. */
function readFields(document: Mapping, line: number): HeaderReading {
  const values = new Map<PlanHeaderField, string>();
  const extras: PlanHeaderExtra[] = [];
  const issues: PlanIssue[] = [];

  for (const [key, value] of Object.entries(document)) {
    if (!isHeaderField(key)) {
      extras.push({ key, value });
      continue;
    }
    const usable = usableField(key, value);
    if (usable === null) issues.push(planIssue('unusable-field', line, unusableText(key, value)));
    else values.set(key, usable);
  }

  const header: PlanHeader = {
    stub: values.get('stub') ?? null,
    issue: values.get('issue') ?? null,
    spec: values.get('spec') ?? null,
    extras,
  };
  return { header, issues };
}

/** Reads the `rafa:plan` block a plan reads, or answers an empty header. */
function readHeader(block: RafaBlock | null): HeaderReading {
  if (block === null) return { header: emptyHeader(), issues: [] };
  const line = block.span.first;

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    const text = `rafa:plan block is not valid YAML (${messageOf(error)})`;
    return { header: emptyHeader(), issues: [planIssue('malformed-header', line, text)] };
  }

  if (document === null) return { header: emptyHeader(), issues: [] };
  if (!isMapping(document)) {
    const text = `rafa:plan block holds ${describeValue(document)}, not a mapping of fields`;
    return { header: emptyHeader(), issues: [planIssue('malformed-header', line, text)] };
  }
  return readFields(document, line);
}

/**
 * Reads a plan document into its model.
 *
 * Takes any string: a plan, its tracker — the plan with the loop's
 * ticks in it — or neither. Answers a new model and never throws;
 * whatever it did not read as written is reported in
 * {@link PlanModel.issues}, ordered by line. See the module note for
 * the rules.
 */
export function parsePlan(markdown: string): PlanModel {
  const blocks = readRafaBlocks(markdown);
  const checklist = readChecklist(markdown, blocks);
  const bound = bindBlocks(blocks, checklist.headings);
  const reading = readHeader(bound.header);

  const stages = checklist.headings.map((heading, index): PlanStage => ({
    name: heading.name,
    lineNum: heading.lineNum,
    context: bound.stageContexts[index] ?? null,
  }));
  const issues = [...checklist.issues, ...bound.issues, ...reading.issues]
    .sort((a, b) => a.line - b.line);

  return {
    header: reading.header,
    context: bound.context?.body ?? null,
    stages,
    tasks: checklist.tasks,
    blocks,
    issues,
  };
}
