/**
 * The bug record (#951): the fields every bug is filed with, the check
 * that refuses a record missing one, the body the fields are written as,
 * and the parser that reads a body back.
 *
 * ## Three axes
 *
 *   - The title, for a person reading a list: `summary`, rendered through
 *     the project's template (`./title.ts`) with the boundary fields.
 *   - The boundary, for knowing where two pieces of work overlap:
 *     `project`, `module`, `action`.
 *   - The context, for knowing what the error looked like and where:
 *     `environment`, `versions`, `errorLine`, `artifact`, and the cause
 *     (`cause`, `proposed`, `suspected`).
 *
 * `reproduce` and `rerun` stand beside them: the steps, or the condition
 * that revealed the bug, and the one command that shows it again.
 *
 * ## The body
 *
 * One `## <Heading>` section per field that holds a value, in the order
 * of {@link BUG_FIELDS}. Two headings are triage's own: the description
 * is `What` and the error output is `Artifact`, both in the fence
 * `fenced` writes (`../triage/issue-text.ts`). So triage's similarity
 * step (`issueTextOf`, `../triage/similarity.ts`) reads a record as it
 * reads a body the loop filed, and a body the loop filed parses as a
 * record with the other fields missing.
 *
 * A value is written plain only when the check holds it to a token:
 * the cause codes, the module, the action and the place. Every free text
 * is fenced, so an `@name` or a `#12` inside it never pings or links on
 * the tracker. The summary has no section: the title holds it.
 *
 * {@link parseBugRecord} reads `##` and `###` headings, a value in a
 * fence or as text, and a heading inside a fence as text. `###` and
 * `_No response_` are what a GitHub issue form writes
 * (`.github/ISSUE_TEMPLATE/bug.yml`).
 *
 * ## The check
 *
 * {@link bugProblems} answers every problem at once, each sentence
 * opening with the field it names, so a filer fixes the line in one go.
 * `module`, `action` and `environment` may be the word `unknown`;
 * `reproduce` never is; `cause` is a code of the list, or
 * `<family>:new-context` with the leaf the filer would have used kept as
 * `proposed` (`context/error-codes.md`).
 *
 * Nothing here redacts: a caller takes local paths and secrets out of
 * the values before it builds the record.
 */
import type { ErrorCodeEntry } from '../errors/codes.js';

import { CODE_PATTERN, familyOf, isKnownCode, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from '../errors/codes.js';
import { fenced } from '../triage/issue-text.js';

import { closestNames } from './closest.js';
import { ACTION_SHAPE, MODULE_SHAPE, renderTitle, titleRoundTrips, UNKNOWN_VALUE } from './title.js';

/** A bug's fields, each null until something fills it. */
export interface BugRecord {
  /** One line saying what is wrong; the title's last part. */
  readonly summary: string | null;
  /** The description. The `What` section. */
  readonly what: string | null;
  /** The steps, or the condition that revealed the bug. Never `unknown`. */
  readonly reproduce: string | null;
  /** One command that shows the bug again. */
  readonly rerun: string | null;
  /** The first line of the error output, with what changes between runs taken out. */
  readonly errorLine: string | null;
  /** The error output and its stack. The `Artifact` section. */
  readonly artifact: string | null;
  /** The cause code: one of the list, or `<family>:new-context`. */
  readonly cause: string | null;
  /** The leaf the filer would have used, beside a `new-context` cause. */
  readonly proposed: string | null;
  /** What the filer thinks went wrong, in words. */
  readonly suspected: string | null;
  /** The module the bug is in, or `unknown`. */
  readonly module: string | null;
  /** What was running: a command, a step, a test; or `unknown`. */
  readonly action: string | null;
  /** The project, where one tracker holds several. */
  readonly project: string | null;
  /** The place it was seen: `local`, `ci`, `prod`, one the project adds, or `unknown`. */
  readonly environment: string | null;
  /** The rafa version, the commit and the package, one `name: value` line each. */
  readonly versions: string | null;
}

/** A record nothing has filled. */
export const EMPTY_BUG_RECORD: BugRecord = Object.freeze({
  summary: null,
  what: null,
  reproduce: null,
  rerun: null,
  errorLine: null,
  artifact: null,
  cause: null,
  proposed: null,
  suspected: null,
  module: null,
  action: null,
  project: null,
  environment: null,
  versions: null,
});

/** How a field's value is written in a body; `unwritten` for one the body never holds. */
export type BugFieldShape = 'fenced' | 'plain' | 'unwritten';

/** One field: its key, the heading of its section, and how its value is written. */
export interface BugFieldSpec {
  readonly key: keyof BugRecord;
  readonly heading: string;
  readonly shape: BugFieldShape;
}

/** Every field, in the order a body writes them; see the module note. */
export const BUG_FIELDS: readonly BugFieldSpec[] = Object.freeze([
  { key: 'summary', heading: 'Summary', shape: 'unwritten' },
  { key: 'what', heading: 'What', shape: 'fenced' },
  { key: 'reproduce', heading: 'Reproduce', shape: 'fenced' },
  { key: 'rerun', heading: 'Rerun', shape: 'fenced' },
  { key: 'errorLine', heading: 'Error line', shape: 'fenced' },
  { key: 'artifact', heading: 'Artifact', shape: 'fenced' },
  { key: 'cause', heading: 'Cause', shape: 'plain' },
  { key: 'proposed', heading: 'Proposed cause', shape: 'plain' },
  { key: 'suspected', heading: 'Suspected cause', shape: 'fenced' },
  { key: 'module', heading: 'Module', shape: 'plain' },
  { key: 'action', heading: 'Action', shape: 'plain' },
  { key: 'project', heading: 'Project', shape: 'fenced' },
  { key: 'environment', heading: 'Environment', shape: 'plain' },
  { key: 'versions', heading: 'Versions', shape: 'fenced' },
] satisfies BugFieldSpec[]);

/** What a record is checked against: the project's template, caps, names and codes. */
export interface BugRules {
  /** The template the title is rendered with. */
  readonly template: string;
  /** The most characters a summary holds. */
  readonly summaryMax: number;
  /** The places a bug may name, without `unknown`, which is always one. */
  readonly environments: readonly string[];
  /** The module names accepted; empty for any name of the shape. */
  readonly modules: readonly string[];
  /** The actions accepted; empty for any of the shape. */
  readonly actions: readonly string[];
  /** The cause codes a bug may carry. */
  readonly codes: readonly ErrorCodeEntry[];
}

/** A `##` or `###` heading, its text captured. */
const HEADING = /^#{2,3} (.+?)\s*$/;

/** A line opening a fence, its backticks captured. */
const FENCE_OPEN = /^(`{3,})/;

/** What a GitHub issue form writes for a field left empty. */
const NO_RESPONSE = '_No response_';

/** A whole module name. */
const MODULE = new RegExp(`^${MODULE_SHAPE}$`);

/** A whole action. */
const ACTION = new RegExp(`^${ACTION_SHAPE}$`);

/** What a refusal says a module looks like. */
const NAME_EXPECTED = 'lower-case letters, digits, ".", "_" and "-"';

/** One section of a body: its heading as written and as a name, and the lines under it. */
interface Section {
  readonly written: string;
  readonly heading: string;
  readonly lines: readonly string[];
}

/** The sections a walk has closed, the one still open, and the fence a line is inside of. */
interface Walk {
  readonly closed: readonly Section[];
  readonly open: Section | null;
  readonly fence: string | null;
}

/** `walk` after one more line; a heading inside a fence is a line of its section. */
function walked(walk: Walk, line: string): Walk {
  const heading = walk.fence === null
    ? HEADING.exec(line)?.[1]
    : undefined;
  if (heading !== undefined) {
    return {
      closed: walk.open === null
        ? walk.closed
        : [...walk.closed, walk.open],
      open: { written: line, heading: heading.trim(), lines: [] },
      fence: null,
    };
  }
  const fence = walk.fence === null
    ? FENCE_OPEN.exec(line)?.[1] ?? null
    : nextFence(walk.fence, line);
  return {
    closed: walk.closed,
    open: walk.open === null
      ? null
      : { ...walk.open, lines: [...walk.open.lines, line] },
    fence,
  };
}

/** The fence still open after `line`: none when the line closes it. */
function nextFence(fence: string, line: string): string | null {
  return line.trim() === fence
    ? null
    : fence;
}

/** A body's sections, in order. The text ahead of the first heading belongs to none. */
function sectionsOf(body: string): readonly Section[] {
  const walk = body.split(/\r?\n/).reduce(walked, { closed: [], open: null, fence: null });
  return walk.open === null
    ? walk.closed
    : [...walk.closed, walk.open];
}

/** `lines` without the blank ones at either end. */
function trimmedLines(lines: readonly string[]): readonly string[] {
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return [];
  const fromEnd = [...lines].reverse().findIndex((line) => line.trim() !== '');
  return lines.slice(start, lines.length - fromEnd);
}

/** A section's value: what its fence holds, or its text; null for none. */
function valueOf(lines: readonly string[]): string | null {
  const kept = trimmedLines(lines);
  const fence = FENCE_OPEN.exec(kept[0] ?? '')?.[1];
  const inner = fence !== undefined && kept.length > 1 && kept.at(-1)?.trim() === fence
    ? kept.slice(1, -1)
    : kept;
  const text = inner.join('\n').trim();
  return text === '' || text === NO_RESPONSE
    ? null
    : text;
}

/** The field a heading names, compared without its case, or undefined. */
function fieldOf(heading: string): BugFieldSpec | undefined {
  return BUG_FIELDS.find((field) => field.heading.toLowerCase() === heading.toLowerCase());
}

/** True when `body` holds a section of the record. */
export function hasBugSections(body: string): boolean {
  return sectionsOf(body).some((section) => fieldOf(section.heading) !== undefined);
}

/** The record `body` holds: each field from the first section under its heading. See the module note. */
export function parseBugRecord(body: string): BugRecord {
  const sections = sectionsOf(body);
  return Object.fromEntries(BUG_FIELDS.map(({ key, heading }) => {
    const section = sections.find((candidate) => candidate.heading.toLowerCase() === heading.toLowerCase());
    return [key, section === undefined
      ? null
      : valueOf(section.lines)];
  })) as unknown as BugRecord;
}

/** The sections of `body` whose heading names no record field, as written and in order; `''` for none. */
export function otherSections(body: string): string {
  const others = sectionsOf(body)
    .filter((section) => fieldOf(section.heading) === undefined)
    .map((section) => [section.written, ...trimmedLinesKeepingLead(section.lines)].join('\n'));
  return others.length === 0
    ? ''
    : `${others.join('\n\n')}\n`;
}

/** A section's lines without the blank ones closing it, one blank line ahead of its text. */
function trimmedLinesKeepingLead(lines: readonly string[]): readonly string[] {
  const kept = trimmedLines(lines);
  return kept.length === 0
    ? []
    : ['', ...kept];
}

/** The body a record is filed with; `''` for a record holding nothing. See the module note. */
export function renderBugBody(record: BugRecord): string {
  const sections = BUG_FIELDS.flatMap(({ key, heading, shape }) => {
    const value = record[key];
    if (shape === 'unwritten' || value === null) return [];
    const shown = shape === 'fenced'
      ? fenced(value)
      : value;
    return [`## ${heading}\n\n${shown}`];
  });
  return sections.length === 0
    ? ''
    : `${sections.join('\n\n')}\n`;
}

/** The title a record is filed under, rendered through the project's template. */
export function bugTitle(record: BugRecord, rules: Pick<BugRules, 'template'>): string {
  return renderTitle(rules.template, {
    type: 'bug',
    project: record.project,
    module: record.module,
    action: record.action,
    summary: record.summary,
  });
}

/** True for a value with something in it. */
function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/** The part of a code after its colon. */
function leafOf(code: string): string {
  return code.slice(code.indexOf(':') + 1);
}

/** What is wrong with the summary. */
function summaryProblems(summary: string | null, max: number): readonly string[] {
  if (!hasText(summary)) return ['summary is missing: pass --summary=<one line>'];
  if (/[\r\n]/.test(summary)) return ['summary holds a line break'];
  const length = Array.from(summary).length;
  return length > max
    ? [`summary is ${length} characters, at most ${max} (issues.titles.summaryMax)`]
    : [];
}

/** What is wrong with the reproduce step, which is never `unknown`. */
function reproduceProblems(reproduce: string | null): readonly string[] {
  return hasText(reproduce) && reproduce.trim().toLowerCase() !== UNKNOWN_VALUE
    ? []
    : ['reproduce is missing: pass --reproduce=<the steps, or the condition that revealed it>; it is never unknown'];
}

/** What is wrong with a proposal, beside a cause that passed. */
function proposedProblems(cause: string, proposed: string | null, codes: readonly ErrorCodeEntry[]): readonly string[] {
  if (!hasText(proposed)) return [];
  if (leafOf(cause) !== NEW_CONTEXT_LEAF) return [`proposed is only read beside a cause ending in :${NEW_CONTEXT_LEAF}`];
  if (!CODE_PATTERN.test(proposed)) return [`proposed is ${JSON.stringify(proposed)}, expected <family>:<leaf> in kebab-case`];
  if (leafOf(proposed) === NEW_CONTEXT_LEAF) {
    return [`proposed ${JSON.stringify(proposed)} ends in ${NEW_CONTEXT_LEAF}, which names no leaf`];
  }
  if (codes.some((entry) => entry.code === proposed)) return [`proposed ${JSON.stringify(proposed)} is already a code: pass it as --cause`];
  return familyOf(cause) !== UNKNOWN_FAMILY && familyOf(proposed) !== familyOf(cause)
    ? [`proposed ${JSON.stringify(proposed)} is of family "${familyOf(proposed)}", and the cause of family "${familyOf(cause)}"`]
    : [];
}

/** What is wrong with the cause and its proposal. */
function causeProblems(cause: string | null, proposed: string | null, codes: readonly ErrorCodeEntry[]): readonly string[] {
  if (!hasText(cause)) {
    return [`cause is missing: pass --cause=<family>:<leaf> from rafa bug codes, or <family>:${NEW_CONTEXT_LEAF}`];
  }
  if (!CODE_PATTERN.test(cause)) return [`cause is ${JSON.stringify(cause)}, expected <family>:<leaf> in kebab-case`];
  if (isKnownCode(cause, codes)) return proposedProblems(cause, proposed, codes);
  if (leafOf(cause) === NEW_CONTEXT_LEAF) {
    return [`cause names the family "${familyOf(cause)}", which no code has: pass ${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF}`];
  }
  const family = codes.some((entry) => familyOf(entry.code) === familyOf(cause))
    ? familyOf(cause)
    : UNKNOWN_FAMILY;
  return [
    `cause ${JSON.stringify(cause)} is not a code of rafa bug codes:`
    + ` pass --cause=${family}:${NEW_CONTEXT_LEAF} --proposed=${cause}`,
  ];
}

/** What is wrong with a module or an action: missing, off its shape, or outside a vocabulary that is set. */
function boundaryProblems(field: 'module' | 'action', value: string | null, vocabulary: readonly string[]): readonly string[] {
  if (!hasText(value)) return [`${field} is missing: pass --${field}=<name>, or --${field}=${UNKNOWN_VALUE}`];
  if (value === UNKNOWN_VALUE) return [];
  const [shape, expected] = field === 'module'
    ? [MODULE, NAME_EXPECTED]
    : [ACTION, `${NAME_EXPECTED}, spaces allowed`];
  if (!shape.test(value)) return [`${field} is ${JSON.stringify(value)}, expected ${expected}`];
  if (vocabulary.length === 0 || vocabulary.includes(value)) return [];
  const closest = closestNames(value, vocabulary);
  const hint = closest.length === 0
    ? ''
    : `; closest: ${closest.join(', ')}`;
  return [`${field} ${JSON.stringify(value)} is not in issues.vocabulary.${field}s${hint}`];
}

/** What is wrong with the place. */
function environmentProblems(environment: string | null, environments: readonly string[]): readonly string[] {
  if (!hasText(environment)) return ['environment is missing: pass --env=<place>'];
  const accepted = [...environments, UNKNOWN_VALUE];
  return accepted.includes(environment)
    ? []
    : [`environment is ${JSON.stringify(environment)}, expected one of: ${accepted.join(', ')}`];
}

/**
 * Every problem of `record` under `rules`, in the order of
 * {@link BUG_FIELDS}, or none. The last, that the title does not read
 * back, is weighed only once the fields the title prints raised nothing.
 * See the module note.
 */
export function bugProblems(record: BugRecord, rules: BugRules): readonly string[] {
  const summary = summaryProblems(record.summary, rules.summaryMax);
  const module = boundaryProblems('module', record.module, rules.modules);
  const action = boundaryProblems('action', record.action, rules.actions);
  const printed = [...summary, ...module, ...action];
  const title = printed.length === 0 && !titleRoundTrips(rules.template, { type: 'bug', ...record })
    ? [`summary reads as another field in the title ${JSON.stringify(bugTitle(record, rules))}: name the module or reword the summary`]
    : [];
  return [
    ...summary,
    ...title,
    ...reproduceProblems(record.reproduce),
    ...causeProblems(record.cause, record.proposed, rules.codes),
    ...module,
    ...action,
    ...environmentProblems(record.environment, rules.environments),
  ];
}
