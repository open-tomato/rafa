/**
 * One field recorded in a generated plan's `rafa:plan` block: the
 * mechanism, and the `issue: <n>` a plan written from the board carries.
 *
 * Four records land in a plan the gate kept. `--skip-review` records
 * `review: skipped`, a session whose review block could not be read
 * records `review: missing` and a verdict every gap of which was
 * non-blocking records `review: assumed`, all three `./review-stamp.ts`'s;
 * and a run that planned from an issue records the issue it planned
 * from, which `.rafa/specs/rafa-20-pr-commands.md` asks for in so many
 * words: the plan's `rafa:plan` block gets `issue: <n>`. All four write
 * ONE line into a block a session wrote, so the line-placing is here and
 * each field's own meaning stays with the module that owns it.
 *
 * Every function here is pure over the plan as text: nothing opens a
 * file, and the caller writes what it is handed. So the cases in
 * `./plan-field.test.ts` need no temporary directory.
 *
 * ## The issue is written QUOTED, and it stays that way
 *
 * `issue` IS one of `PLAN_HEADER_FIELDS` (`src/plan/parse.ts`), and the
 * reader takes a whole number there as well as a string: `issue: 20`
 * reads back as `"20"`. It reads the number YAML parsed, not the digits
 * written, so `issue: 042` reads back as `"42"`. The stamp writes
 * `issue: "20"` so the digits it wrote are the digits read back whatever
 * they are, and `plan validate` reads the plan it stamped without an
 * issue. Measured on bun 1.3.14 on 2026-09-20, and held by the
 * round-trip case in `./plan-field.test.ts`, whose control is the
 * leading-zero spelling the quoted line is immune to.
 *
 * A block already carrying `issue: 20` unquoted is REPLACED by the quoted
 * line for the same reason: a session that wrote the field by hand wrote
 * it in the shape whose digits the reader cannot be trusted to give back.
 *
 * ## What it does to the file
 *
 * One line, inserted directly above the block's closing fence with the
 * opening fence's indentation, or the existing line for that field
 * replaced where the block already carries one. Every other byte of the
 * plan is left as it was, the line endings included: the document is
 * split on `\n` and joined on `\n`, so a `\r` that ended a line still
 * ends it, and the inserted line takes the `\r` of the fence it follows.
 * The plan is a file a person reads and a session wrote; a stamp that
 * reformatted it would turn one recorded field into a diff nobody asked
 * for.
 *
 * Only a key at the BLOCK'S OWN indentation is the field: one indented
 * further sits inside another key's mapping, and replacing it would edit
 * somebody else's value.
 *
 * A plan with no `rafa:plan` block, or one the document never closed, is
 * left untouched and reported. Writing a block for it would put a header
 * on a plan whose own header was unreadable, and the stamp is a record,
 * not a repair: {@link PlanFieldStamp.recorded} is false and
 * {@link PlanFieldStamp.note} says what was in the way, for the caller to
 * warn with.
 */
import { readRafaBlocks } from '../plan/blocks.js';

/** The block kind a field is recorded in. */
const PLAN_BLOCK_KIND = 'plan';

/** A field name this module will record: the shape a `rafa:plan` key has. */
const FIELD_NAME = /^[a-z][a-z-]*$/u;

/** The `rafa:plan` field a plan off the board records. */
export const ISSUE_FIELD = 'issue';

/** What a stamp did, or what stopped it. */
export type PlanFieldAnswer =
  /** The block carried no such key, so the line was added. */
  | 'inserted'
  /** The block carried another value for the field, which was replaced. */
  | 'replaced'
  /** The block already recorded this line; no byte changed. */
  | 'unchanged'
  /** The plan holds no `rafa:plan` block. Nothing was recorded. */
  | 'no-block'
  /** The plan's `rafa:plan` block is never closed. Nothing was recorded. */
  | 'unclosed-block';

/** One plan, stamped. */
export interface PlanFieldStamp {
  /** What happened; see {@link PlanFieldAnswer}. */
  readonly answer: PlanFieldAnswer;
  /** The plan as it now stands, byte-identical to the input when nothing was recorded. */
  readonly text: string;
  /** True when the plan records the line once this text is written. */
  readonly recorded: boolean;
  /** One sentence for an operator to read. */
  readonly note: string;
}

/** A reading that recorded nothing, carrying why. */
function unrecorded(answer: PlanFieldAnswer, text: string, note: string): PlanFieldStamp {
  return { answer, text, recorded: false, note };
}

/** The whitespace a line opens with. */
function indentOf(line: string): string {
  return /^\s*/u.exec(line)?.[0] ?? '';
}

/** The `\r` a line carries before its newline, or the empty string. */
function carriageOf(line: string): string {
  return line.endsWith('\r')
    ? '\r'
    : '';
}

/** A `field:` key at the top level of a block body, with its value captured. */
function fieldLine(field: string): RegExp {
  if (!FIELD_NAME.test(field)) {
    throw new TypeError(`board plan field: ${JSON.stringify(field)} is no rafa:plan key this records`);
  }
  return new RegExp(`^(\\s*)${field}\\s*:(.*)$`, 'u');
}

/**
 * The plan with `<field>: <value>` recorded in its `rafa:plan` block.
 *
 * `value` is written as it is handed over, so a caller whose value needs
 * quoting quotes it ({@link issueFieldLine}). Takes the plan as read and
 * answers the text to write; never throws for a plan it cannot stamp, and
 * never touches a file. Throws a `TypeError` for a `field` that is no
 * `rafa:plan` key, which is a defect in the caller.
 *
 * See the module note for where the line goes, what is left alone, and
 * what a plan with no readable block answers.
 */
export function stampPlanField(plan: string, field: string, value: string): PlanFieldStamp {
  const pattern = fieldLine(field);
  const line = `${field}: ${value}`;
  const block = readRafaBlocks(plan).find((found) => found.kind === PLAN_BLOCK_KIND);
  if (block === undefined) {
    return unrecorded('no-block', plan, 'the plan holds no rafa:plan block to record it in');
  }
  if (!block.closed) {
    return unrecorded(
      'unclosed-block',
      plan,
      `the rafa:plan block at line ${String(block.span.first)} is never closed, so nothing was recorded in it`,
    );
  }

  const lines = plan.split('\n');
  const opening = lines[block.span.first - 1] ?? '';
  const indent = indentOf(opening);
  const written = `${indent}${line}${carriageOf(opening)}`;

  for (let index = block.span.first; index < block.span.last - 1; index += 1) {
    const found = pattern.exec(lines[index] ?? '');
    if (found === null || found[1] !== indent) continue;
    if ((found[2] ?? '').trim() === value) {
      return { answer: 'unchanged', text: plan, recorded: true, note: `the plan already records ${line}` };
    }
    const replaced = [...lines];
    replaced[index] = written;
    return {
      answer: 'replaced',
      text: replaced.join('\n'),
      recorded: true,
      note: `line ${String(index + 1)} of the plan now records ${line}`,
    };
  }

  const at = block.span.last - 1;
  const stamped = [...lines.slice(0, at), written, ...lines.slice(at)];
  return {
    answer: 'inserted',
    text: stamped.join('\n'),
    recorded: true,
    note: `line ${String(at + 1)} of the plan now records ${line}`,
  };
}

/**
 * The line a plan off the board records, the number quoted as the plan
 * reader takes it; the module note holds why it is not written bare.
 *
 * Throws a `TypeError` for a number that is not a positive whole one,
 * which is a defect in the caller rather than a person's typo: the
 * command line's own refusal is `./spec-source.ts`'s.
 */
export function issueFieldLine(issue: number): string {
  if (!Number.isSafeInteger(issue) || issue < 1) {
    throw new TypeError(`board plan field: issue ${String(issue)} is no issue number, expected a positive whole one`);
  }
  return `${ISSUE_FIELD}: ${JSON.stringify(String(issue))}`;
}

/** The plan with `issue: "<n>"` recorded in its `rafa:plan` block. */
export function stampPlanIssue(plan: string, issue: number): PlanFieldStamp {
  return stampPlanField(plan, ISSUE_FIELD, JSON.stringify(String(issue)));
}
