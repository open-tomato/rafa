/**
 * The body of an epic issue, read: its acceptance criteria, its estimate,
 * its date, the folders its `Owns:` line names and its ordered checklist
 * of specs, with every part a body got wrong named as a problem.
 *
 * An epic is an issue labelled `type:epic` and `epic:<slug>`
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). Its body stores
 * INTENT only; every state it is in is computed from the board listing by
 * `./epics.ts`, and nothing this module answers is a state. The body's
 * shape is the plan's reading of the spec:
 *
 * ```markdown
 * ## Acceptance criteria
 *
 * - `rafa roadmap` lists epics grouped by horizon.
 *
 * Estimate: two weeks
 * Date: 2026-10-31
 * Owns: src/board/, src/commands/epics.ts
 *
 * - [ ] #245 the listing
 * - [ ] #246 the model
 * ```
 *
 * Nothing here spawns `gh`, reads git or opens a file:
 * {@link readEpicBody} is a pure function over the body text, so every
 * case in `./epic-body.test.ts` is a literal string.
 *
 * ## The checklist is the roadmap's
 *
 * The ordered `- [ ] #<n>` lines are {@link parseRoadmapBody}'s answer,
 * taken whole and never respelled, so an epic's order and the roadmap's
 * are read by one rule: fenced lines skipped, an item not opening with
 * `#<n>` dropped, a repeated issue kept on both lines. Membership is the
 * `epic:<slug>` label and is not this module's to read.
 *
 * ## The criteria section
 *
 * The acceptance criteria are what sits under a heading reading
 * `Acceptance criteria` (any level, case folded, a trailing colon
 * allowed), up to the next heading of the same level or a higher one.
 * The text is kept as written, blank lines at either end trimmed and
 * line breaks spelled `\n` whatever the body used, because `plan create`
 * hands it to the planner verbatim. A heading inside a fenced block is not
 * a heading, either as the section's start or as its end, so an example
 * quoted in the criteria stays in them.
 *
 * ## The field lines
 *
 * `Estimate:`, `Date:` and `Owns:` are matched as `./blocked.ts` matches
 * `Blocked by:`: case folded, at the start of a line after up to three
 * spaces and an optional bullet, the emphasis a person dresses the name
 * in taken off, the colon required. The first such line outside a fence
 * is the field; a second is left alone, so a body carrying the field
 * twice is read as its first answer. A field line inside the criteria
 * section still counts — the section is prose, and the field is found by
 * its name wherever the author put it.
 *
 * - The ESTIMATE is free text, trimmed.
 * - The DATE is `YYYY-MM-DD` and a real calendar day; `2026-02-30`,
 *   `31/10/2026` and `next week` are all malformed. A malformed date is
 *   reported by name and the epic is read as having NO date, because a
 *   guessed one would call an epic late on a day nobody wrote down. The
 *   date is kept as that string, which compares with another ISO day by
 *   plain string order.
 * - The OWNS line names folders separated by commas or spaces, with
 *   backticks taken off, deduped in the order written. The borders spec
 *   reads them; this module does not check that they exist.
 *
 * ## Problems
 *
 * A body with no criteria, no estimate or a malformed date answers what
 * it could read and lists each gap in {@link EpicBody.problems}, one
 * entry per gap: the reader never throws, because a board read that
 * stopped on one badly written epic would hide every other. The date and
 * `Owns:` line are optional, so their absence is no problem; an empty
 * `Owns:` line reads as no folders. {@link epicBodyProblemMessage} spells
 * the sentence a report prints for each.
 */
import type { RoadmapLine } from './roadmap.js';

import { parseRoadmapBody } from './roadmap.js';

/** The heading the criteria section carries, as a report names it. */
export const CRITERIA_HEADING = 'Acceptance criteria';

/** The free-text estimate's field name. */
export const ESTIMATE_FIELD = 'Estimate';

/** The optional date's field name. */
export const DATE_FIELD = 'Date';

/** The optional owned-folders field name. */
export const OWNS_FIELD = 'Owns';

/** The one date shape read, as a message spells it. */
export const DATE_SHAPE = 'YYYY-MM-DD';

/** A fence opening or closing a code block; `parseRoadmapBody`'s own rule. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;

/** An ATX heading: its hashes and its text. */
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u;

/** The criteria heading's text, trailing colon allowed. */
const CRITERIA_TITLE = /^acceptance\s+criteria\s*:?$/iu;

/** A date as written: four digits, two, two. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** What separates two folders on an `Owns:` line. */
const OWNS_SEPARATOR = /[\s,]+/u;

/** Which part of the body a problem is about. */
export type EpicBodyProblemKind =
  /** No `Acceptance criteria` heading, or one with nothing under it. */
  | 'no-criteria'
  /** No `Estimate:` line, or one with nothing after the colon. */
  | 'no-estimate'
  /** A `Date:` line that is not a real `YYYY-MM-DD` day. */
  | 'malformed-date';

/** One gap in an epic body. */
export interface EpicBodyProblem {
  /** Which part it is about. */
  readonly kind: EpicBodyProblemKind;
  /** The 1-based line it sits on, or null when the part is absent. */
  readonly line: number | null;
  /** What the line said after its colon, trimmed, or null when absent. */
  readonly text: string | null;
}

/** An epic body, read. */
export interface EpicBody {
  /** The criteria section's text, trimmed, or null when missing or blank. */
  readonly criteria: string | null;
  /** The estimate, trimmed, or null when missing or blank. */
  readonly estimate: string | null;
  /** The date as `YYYY-MM-DD`, or null when absent or malformed. */
  readonly date: string | null;
  /** The folders the `Owns:` line names, deduped in order; empty when none. */
  readonly owns: readonly string[];
  /** The checklist, as {@link parseRoadmapBody} reads it. */
  readonly lines: readonly RoadmapLine[];
  /** Every gap, in the order {@link EpicBodyProblemKind} lists them. */
  readonly problems: readonly EpicBodyProblem[];
}

/** One body line and whether it sits inside a fence. */
export interface BodyLine {
  readonly text: string;
  readonly fenced: boolean;
}

/** One field line: its 1-based number and the text after its colon. */
export interface FieldLine {
  readonly number: number;
  readonly text: string;
}

/** `body` split as {@link parseRoadmapBody} splits it, each line marked fenced or not. */
export function bodyLines(body: string): readonly BodyLine[] {
  let fenced = false;
  return body.split(/\r\n?|\n/u).map((text) => {
    if (FENCE.test(text)) {
      fenced = !fenced;
      return { text, fenced: true };
    }
    return { text, fenced };
  });
}

/** The matcher for a field line named `name`: indent, bullet, dressing, colon. */
function fieldPattern(name: string): RegExp {
  return new RegExp(`^ {0,3}(?:[-*+]\\s+)?[*_]{0,2}${name}[*_]{0,2}\\s*:[*_]{0,2}(.*)$`, 'iu');
}

/** The first line outside a fence carrying the field `name`, or null. */
export function findField(lines: readonly BodyLine[], name: string): FieldLine | null {
  const pattern = fieldPattern(name);
  for (const [index, line] of lines.entries()) {
    if (line.fenced) continue;
    const found = pattern.exec(line.text);
    if (found !== null) return { number: index + 1, text: (found[1] ?? '').trim() };
  }
  return null;
}

/** The level of the heading `line` is, or 0 when it is not one. */
function headingLevel(line: BodyLine): number {
  if (line.fenced) return 0;
  return HEADING.exec(line.text)?.[1]?.length ?? 0;
}

/** The criteria heading and the text under it, or null when there is no heading. */
function findCriteria(lines: readonly BodyLine[]): FieldLine | null {
  const start = lines.findIndex((line) => headingLevel(line) > 0
    && CRITERIA_TITLE.test(HEADING.exec(line.text)?.[2] ?? ''));
  const opening = lines[start];
  if (opening === undefined) return null;

  const level = headingLevel(opening);
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => {
    const found = headingLevel(line);
    return found > 0 && found <= level;
  });
  const section = end === -1
    ? after
    : after.slice(0, end);

  return {
    number: start + 1,
    text: section.map((line) => line.text).join('\n')
      .trim(),
  };
}

/** True when `text` is a `YYYY-MM-DD` day the calendar has. */
function isCalendarDay(text: string): boolean {
  const found = ISO_DAY.exec(text);
  if (found === null) return false;

  const [, year = '', month = '', day = ''] = found;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, DATE_SHAPE.length) === text;
}

/** The folders an `Owns:` line names, backticks off, deduped in order. */
function ownedFolders(text: string): readonly string[] {
  const named = text.replaceAll('`', ' ')
    .split(OWNS_SEPARATOR)
    .filter((folder) => folder !== '');
  return [...new Set(named)];
}

/** The problem for a part that is absent or blank; the line kept when there is one. */
function absent(kind: EpicBodyProblemKind, found: FieldLine | null): EpicBodyProblem {
  return { kind, line: found?.number ?? null, text: found?.text ?? null };
}

/**
 * The epic body `body`, read: every part it could read, and every gap in
 * {@link EpicBody.problems}. Never throws; the module note holds why.
 */
export function readEpicBody(body: string): EpicBody {
  const lines = bodyLines(body);
  const criteria = findCriteria(lines);
  const estimate = findField(lines, ESTIMATE_FIELD);
  const date = findField(lines, DATE_FIELD);
  const owns = findField(lines, OWNS_FIELD);

  const hasCriteria = criteria !== null && criteria.text !== '';
  const hasEstimate = estimate !== null && estimate.text !== '';
  const isDated = date !== null && isCalendarDay(date.text);

  const problems: readonly (EpicBodyProblem | null)[] = [
    hasCriteria
      ? null
      : absent('no-criteria', criteria),
    hasEstimate
      ? null
      : absent('no-estimate', estimate),
    date === null || isDated
      ? null
      : { kind: 'malformed-date', line: date.number, text: date.text },
  ];

  return Object.freeze({
    criteria: hasCriteria
      ? criteria.text
      : null,
    estimate: hasEstimate
      ? estimate.text
      : null,
    date: isDated
      ? date.text
      : null,
    owns: Object.freeze(owns === null
      ? []
      : ownedFolders(owns.text)),
    lines: parseRoadmapBody(body),
    problems: Object.freeze(problems.filter((problem) => problem !== null)),
  });
}

/**
 * The sentence a report prints for one of epic `issue`'s body problems:
 * the epic, what is wrong and what an author writes to fix it.
 */
export function epicBodyProblemMessage(issue: number, problem: EpicBodyProblem): string {
  const id = `epic #${String(issue)}`;
  const at = `on line ${String(problem.line ?? 0)}`;

  if (problem.kind === 'malformed-date') {
    return `${id} has a "${DATE_FIELD}:" line ${at} reading "${problem.text ?? ''}", which is not a ${DATE_SHAPE} day;`
      + ' it is read as having no date until the line is fixed';
  }
  if (problem.kind === 'no-estimate') {
    return problem.line === null
      ? `${id} carries no "${ESTIMATE_FIELD}:" line; add one in free text`
      : `${id} has an "${ESTIMATE_FIELD}:" line ${at} with nothing after it; write the estimate in free text`;
  }
  return problem.line === null
    ? `${id} carries no "## ${CRITERIA_HEADING}" section; add one holding what makes the feature finished`
    : `${id} has a "${CRITERIA_HEADING}" heading ${at} with nothing under it; write what makes the feature finished`;
}
