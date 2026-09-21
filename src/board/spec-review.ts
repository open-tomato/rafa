/**
 * The planner's own reading of a spec: the `rafa:spec-review` block the
 * plan session ENDS its final message with, read out of the session's
 * captured output.
 *
 * This is check 3 of the readiness gate, and the only one that costs a
 * session. Checks 1 and 2 (`./readiness.ts`) read the label and the
 * body's shape; they cannot tell whether a definition-of-done item can
 * be SHOWN by a command, or whether a task names what it changes. The
 * plan prompt asks the session to judge that before planning and to end
 * its final message with
 *
 * ````markdown
 * ```rafa:spec-review
 * verdict: ready | not-ready
 * gaps:
 *   - heading: "Definition of done"
 *     what: "no item says how the merge clean-up is verified"
 * ```
 * ````
 *
 * {@link parseSpecReview} is the whole interface. It takes any string,
 * never throws, and answers one of four readings: `ready`, `not-ready`,
 * `absent` and `malformed`. The prompt asks for the block and the gate
 * has to live without it, so a missing review is an answer here, not an
 * exception.
 *
 * ## Absence and malformation are not ready either
 *
 * A missing or malformed block is READ as not ready, with the gap "the
 * review block was not returned", and that rule lives HERE rather than
 * in the caller. {@link SpecReviewReading.ready} is true for exactly one
 * of the four readings; {@link SpecReviewReading.answer} keeps the four
 * apart for whoever is diagnosing a session rather than gating on it. A
 * caller that switched on the verdict alone would let a truncated
 * session through as if nobody had judged the spec, which is the one
 * failure this gate exists to prevent.
 *
 * What the ENFORCING half does with each of the four is `./gate.ts`'s,
 * and the two halves no longer agree by construction: since 2026-09-20
 * an `absent` or `malformed` reading lets a plan that reads as written
 * stand, stamped `review: missing`, where an explicit `not-ready`
 * verdict removes it. So `answer` is what that caller switches on and
 * `ready` is what it refuses to plan from unweighed; a reading here is
 * still never ready for one of the last two.
 *
 * For the same reason {@link SpecReviewReading.gaps} is never empty for
 * a reading that is not ready. A `not-ready` verdict that names no
 * usable gap gets {@link UNNAMED_GAP}, because the gaps are what the
 * issue comment is made of and an empty comment tells the author
 * nothing about what to fix.
 *
 * ## Which block is read
 *
 * Blocks are found by `readRafaBlocks`, so fences follow its rules: a
 * `rafa:spec-review` fence that does not open its line is prose quoting
 * the syntax, and a review illustrated inside a longer fence is that
 * fence's body. Blocks of every other kind are ignored.
 *
 * Only the LAST `rafa:spec-review` block counts, the same rule
 * `report/parse.ts` applies to `rafa:report`, and for the same reason:
 * what a `-p` session hands back is its FINAL message, written after
 * every tool turn, so the block the prompt asks for sits at the END of
 * it and anything earlier is a draft or the session quoting the format
 * while it works.
 *
 * This module read the FIRST block until 2026-09-20, when the prompt
 * asked the session to OPEN its answer with the review. That ask had no
 * place to land: a planning session reasons across tool turns and only
 * then writes the message that is captured, so the block it was asked
 * to write first was regularly never written at all — a valid 22-task
 * plan was deleted by the readiness gate over a review block the
 * session had no opening to put it in. `rafa:report` works because it
 * is asked for at the END, and the review is asked for there now.
 *
 * An unclosed block is `malformed` rather than read. A body cut short
 * can still be valid YAML with its later gaps missing, and a session
 * that died mid-answer has judged nothing; reading it would post a
 * shortened gap list, or pass a `verdict: ready` nobody finished
 * writing.
 *
 * ## The verdict
 *
 * The verdict is normalised before it is matched: trimmed, lower-cased,
 * and each run of whitespace or underscores turned into the hyphen the
 * spec spells it with. `Ready`, `NOT READY` and `not_ready` are the two
 * words a model meant, and refusing them would spend a session to
 * answer `malformed`. Anything else is `malformed`, which lands on
 * not-ready anyway, so the leniency only ever saves a session that had
 * already made up its mind.
 *
 * ## Gaps
 *
 * A gap carries the `heading` it sits under and `what` is wrong with
 * it, the two fields `ReadinessGap` shares, so the not-ready comment
 * prints the code gaps and the reviewed gaps as one list.
 *
 *   - `gaps` absent or null names no gap. For a `ready` verdict that is
 *     the ordinary case.
 *   - `gaps` holding anything but a list is reported and read as empty.
 *   - An entry that is not a mapping is dropped and reported.
 *   - An entry whose `what` is absent, blank or not a string is dropped
 *     and reported: a gap that says nothing sends the author looking.
 *   - An entry whose `heading` is unusable keeps its `what` under
 *     {@link REVIEW_HEADING}, because the sentence is the part the
 *     author acts on and a gap is worth more misfiled than lost.
 *
 * Every drop is recorded in {@link SpecReviewReading.issues}, whose
 * `field` is a path in the block's own key names (`gaps[2].what`) so it
 * can be found in the block as written. A key naming no field is
 * IGNORED rather than refused, the rule `utils/declaration.ts` applies
 * to an unrecognised key: a review block written for a later phase must
 * not break this one.
 *
 * Strings are kept as written, never trimmed. Nothing is deduped: two
 * gaps naming the same heading are two gaps.
 *
 * ## The parser, measured on bun 1.3.14
 *
 * `Bun.YAML.parse` reads the body, so the readings `report/parse.ts`
 * records apply here too. The ones that bite a review: an unquoted
 * value opening with a backtick, `@`, `%` or `[` throws and makes the
 * whole block `malformed`; a `#` after a space opens a comment and
 * silently cuts a `what` short; and an empty body parses as null, which
 * is no mapping and so `malformed`.
 */
import type { RafaBlock } from '../plan/blocks.js';

import { readRafaBlocks } from '../plan/blocks.js';

/** The block kind a spec review is read from. */
export const SPEC_REVIEW_KIND = 'spec-review';

/** The two words the block's `verdict` is spelled with. */
export const SPEC_REVIEW_VERDICTS = ['ready', 'not-ready'] as const;

/** One of the two verdicts a session can write. */
export type SpecReviewVerdict = (typeof SPEC_REVIEW_VERDICTS)[number];

/**
 * The four readings a session output answers. The first two are the
 * verdicts as written; the last two are a block that could not be read,
 * and are not-ready all the same.
 */
export const SPEC_REVIEW_ANSWERS = ['ready', 'not-ready', 'absent', 'malformed'] as const;

/** One of the four readings; see {@link SPEC_REVIEW_ANSWERS}. */
export type SpecReviewAnswer = (typeof SPEC_REVIEW_ANSWERS)[number];

/** What a gap about the review itself, rather than the spec, names. */
export const REVIEW_HEADING = 'the review';

/** One thing the planner found keeping a spec from being planned from. */
export interface SpecReviewGap {
  /** The spec heading it sits under, as the comment names it. */
  readonly heading: string;
  /** What is wrong under that heading, as the session wrote it. */
  readonly what: string;
}

/** The gap a session that returned no readable block is refused with. */
export const MISSING_REVIEW_GAP: SpecReviewGap = {
  heading: REVIEW_HEADING,
  what: 'the review block was not returned',
};

/** The gap a `not-ready` verdict naming no usable gap is refused with. */
export const UNNAMED_GAP: SpecReviewGap = {
  heading: REVIEW_HEADING,
  what: 'the review block judged the spec not ready without naming a gap',
};

/** One thing the block said that this reading does not hold as written. */
export interface SpecReviewIssue {
  /** Where, in the block's own key names: `gaps[2].what`. */
  readonly field: string;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** A session output, read for its `rafa:spec-review` block. */
export interface SpecReviewReading {
  /** Which of the four readings this is. */
  readonly answer: SpecReviewAnswer;
  /** True for `ready` alone; what the gate acts on. */
  readonly ready: boolean;
  /**
   * Every gap to post. Empty only for a ready reading; see the module
   * note for what fills it when the session named none.
   */
  readonly gaps: readonly SpecReviewGap[];
  /** The last `rafa:spec-review` block, or null when there is none. */
  readonly block: RafaBlock | null;
  /** One sentence for an operator to read. */
  readonly text: string;
  /** What was not read as written. Empty for a clean block. */
  readonly issues: readonly SpecReviewIssue[];
}

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** What separates the words of a verdict before it is matched. */
const VERDICT_BREAK = /[\s_]+/gu;

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as an issue quotes it. Never serialises a collection. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `the ${typeof value} ${String(value)}`;
}

/** The message of whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** `count` of `noun`, pluralised the only way these nouns need. */
function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}

/**
 * A key's value, or null when the mapping does not carry it. Looked up
 * by own key rather than by object index, the rule `report/parse.ts`
 * follows, so a body spelling a key `constructor` reads as a key.
 */
function valueAt(mapping: Mapping, key: string): unknown {
  return Object.hasOwn(mapping, key)
    ? mapping[key] ?? null
    : null;
}

/** A field's value as written, or null when it is no usable string. */
function stringAt(mapping: Mapping, key: string): string | null {
  const value = valueAt(mapping, key);
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value;
}

/** The verdict `value` spells, or null when it spells neither. */
function verdictOf(value: unknown): SpecReviewVerdict | null {
  if (typeof value !== 'string') return null;
  const spelled = value.trim().toLowerCase();
  const word = spelled.replace(VERDICT_BREAK, '-');
  return (SPEC_REVIEW_VERDICTS as readonly string[]).includes(word)
    ? word as SpecReviewVerdict
    : null;
}

/** One issue. */
function issueAt(field: string, text: string): SpecReviewIssue {
  return { field, text };
}

/**
 * The gap one `gaps` entry names, or null after recording why it is
 * dropped. An unusable `heading` is recorded and replaced; an unusable
 * `what` drops the entry, since it carried nothing to act on.
 */
function readGap(item: unknown, field: string, issues: SpecReviewIssue[]): SpecReviewGap | null {
  if (!isMapping(item)) {
    const text = `${field} is ${describeValue(item)}, not a mapping of heading and what; dropped`;
    issues.push(issueAt(field, text));
    return null;
  }

  const what = stringAt(item, 'what');
  if (what === null) {
    const text = `${field}.what is ${describeValue(valueAt(item, 'what'))}, `
      + 'not a sentence; the gap is dropped';
    issues.push(issueAt(`${field}.what`, text));
    return null;
  }

  const heading = stringAt(item, 'heading');
  if (heading === null) {
    const text = `${field}.heading is ${describeValue(valueAt(item, 'heading'))}, `
      + `not a heading; the gap is filed under ${REVIEW_HEADING}`;
    issues.push(issueAt(`${field}.heading`, text));
  }

  return { heading: heading ?? REVIEW_HEADING, what };
}

/** Every usable gap the block names, in the order it wrote them. */
function readGaps(document: Mapping, issues: SpecReviewIssue[]): readonly SpecReviewGap[] {
  const value = valueAt(document, 'gaps');
  if (value === null) return [];
  if (!Array.isArray(value)) {
    const text = `gaps is ${describeValue(value)}, not a list; no gap is read from it`;
    issues.push(issueAt('gaps', text));
    return [];
  }

  const items: readonly unknown[] = value;
  const gaps: SpecReviewGap[] = [];
  for (const [index, item] of items.entries()) {
    const gap = readGap(item, `gaps[${String(index)}]`, issues);
    if (gap !== null) gaps.push(gap);
  }
  return gaps;
}

/** A reading whose block could not be read: not ready, and why. */
function unreadable(
  answer: SpecReviewAnswer,
  block: RafaBlock | null,
  text: string,
): SpecReviewReading {
  return { answer, ready: false, gaps: [MISSING_REVIEW_GAP], block, text, issues: [] };
}

/** The reading a readable block of `verdict` and `gaps` answers. */
function judged(
  verdict: SpecReviewVerdict,
  gaps: readonly SpecReviewGap[],
  block: RafaBlock,
  issues: readonly SpecReviewIssue[],
): SpecReviewReading {
  const line = String(block.span.first);
  if (verdict === 'ready') {
    return {
      answer: 'ready',
      ready: true,
      gaps,
      block,
      text: `the rafa:spec-review block at line ${line} judged the spec ready`,
      issues,
    };
  }

  const named = gaps.length === 0
    ? [UNNAMED_GAP]
    : gaps;
  return {
    answer: 'not-ready',
    ready: false,
    gaps: named,
    block,
    text: `the rafa:spec-review block at line ${line} judged the spec not ready, `
      + `naming ${counted(named.length, 'gap')}`,
    issues,
  };
}

/**
 * Reads the last `rafa:spec-review` block out of a plan session's
 * captured output.
 *
 * Takes any string, normally `CapturedSession.stdout`. Answers one of
 * four readings, of which only `ready` lets a plan stand; the other
 * three carry the gaps the gate posts on the issue. Never throws. See
 * the module note for which block counts, how the verdict is matched
 * and what happens to a gap that cannot be read.
 */
export function parseSpecReview(output: string): SpecReviewReading {
  const reviews = readRafaBlocks(output).filter((found) => found.kind === SPEC_REVIEW_KIND);
  const block = reviews.at(-1);
  if (block === undefined) {
    return unreadable('absent', null, 'the session output holds no rafa:spec-review block');
  }

  const line = String(block.span.first);
  if (!block.closed) {
    return unreadable(
      'malformed',
      block,
      `the rafa:spec-review block at line ${line} is never closed, so its body may have been `
        + 'cut short and is not read',
    );
  }

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    const text = `the rafa:spec-review block at line ${line} is not valid YAML `
      + `(${messageOf(error)})`;
    return unreadable('malformed', block, text);
  }

  if (!isMapping(document)) {
    const text = `the rafa:spec-review block at line ${line} holds ${describeValue(document)}, `
      + 'not a mapping of verdict and gaps';
    return unreadable('malformed', block, text);
  }

  const verdict = verdictOf(valueAt(document, 'verdict'));
  if (verdict === null) {
    const text = `the rafa:spec-review block at line ${line} has a verdict of `
      + `${describeValue(valueAt(document, 'verdict'))}, `
      + `not one of ${SPEC_REVIEW_VERDICTS.join(', ')}`;
    return unreadable('malformed', block, text);
  }

  const issues: SpecReviewIssue[] = [];
  return judged(verdict, readGaps(document, issues), block, issues);
}
