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
 * `fenced` writes (`./fenced.ts`). So triage's similarity
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
 * fence or as text, and a heading inside a fence as text. A fence is
 * three or more backticks or tildes, indented by three spaces at most,
 * closed by a line of the same mark at least as long. `###` and
 * `_No response_` are what a GitHub issue form writes
 * (`.github/ISSUE_TEMPLATE/bug.yml`).
 *
 * Nothing a filer wrote is dropped without a word. The text ahead of the
 * first heading is the description when no `What` section holds one, and
 * {@link otherSections} answers the rest for the caller to file after
 * the record's own sections: that text beside a `What` section, a
 * section that is no field, and the second section under one heading.
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

import { closestNames } from './closest.js';
import { fenced } from './fenced.js';
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

/** A line opening a fence: up to three spaces, then three or more backticks or tildes, captured. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

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

/** A body walked once: the lines ahead of its first heading, then its sections in order. */
interface Sections {
  readonly lead: readonly string[];
  readonly sections: readonly Section[];
}

/** True when `line` closes the fence `fence` opened: the same mark, at least as long, and nothing else. */
function closesFence(fence: string, line: string): boolean {
  const mark = line.trim();
  return mark.length >= fence.length && mark === fence.charAt(0).repeat(mark.length);
}

/**
 * A body's sections, a heading inside a fence read as a line of its
 * section. One pass, each line appended to the section it falls in: a
 * body is a pasted log as often as a paragraph, and a walk copying a
 * section per line took seconds on a few thousand lines.
 */
function sectionsOf(body: string): Sections {
  const lead: string[] = [];
  const sections: { written: string; heading: string; lines: string[] }[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = fence === null
      ? HEADING.exec(line)?.[1]
      : undefined;
    if (heading !== undefined) {
      sections.push({ written: line, heading: heading.trim(), lines: [] });
      continue;
    }
    if (fence === null) fence = FENCE_OPEN.exec(line)?.[1] ?? null;
    else if (closesFence(fence, line)) fence = null;
    (sections.at(-1)?.lines ?? lead).push(line);
  }
  return { lead, sections };
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
  const inner = fence !== undefined && kept.length > 1 && closesFence(fence, kept.at(-1) ?? '')
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

/**
 * A body sorted into what the record reads and what it does not: the
 * text ahead of the first heading, the first section under each field's
 * heading, and every other section, a field's heading used a second time
 * among them, in the order read.
 */
interface SortedBody {
  readonly lead: string;
  readonly fields: ReadonlyMap<keyof BugRecord, Section>;
  readonly others: readonly Section[];
}

/** `body`, sorted; see {@link SortedBody}. */
function sortedBody(body: string): SortedBody {
  const { lead, sections } = sectionsOf(body);
  const fields = new Map<keyof BugRecord, Section>();
  const others: Section[] = [];
  for (const section of sections) {
    const field = fieldOf(section.heading);
    if (field === undefined || fields.has(field.key)) others.push(section);
    else fields.set(field.key, section);
  }
  return { lead: trimmedLines(lead).join('\n'), fields, others };
}

/** The value of the section a sorted body holds for `key`, or null. */
function fieldValue(sorted: SortedBody, key: keyof BugRecord): string | null {
  const section = sorted.fields.get(key);
  return section === undefined
    ? null
    : valueOf(section.lines);
}

/** True when `body` holds a section of the record. */
export function hasBugSections(body: string): boolean {
  return sortedBody(body).fields.size > 0;
}

/**
 * The record `body` holds: each field from the first section under its
 * heading. The text ahead of the first heading is the description when
 * no `What` section holds one, so a paragraph written above the sections
 * is never dropped. See the module note.
 */
export function parseBugRecord(body: string): BugRecord {
  const sorted = sortedBody(body);
  const read = Object.fromEntries(BUG_FIELDS.map(({ key }) => [key, fieldValue(sorted, key)])) as unknown as BugRecord;
  return read.what === null && sorted.lead !== ''
    ? { ...read, what: sorted.lead }
    : read;
}

/** A section as written: its heading, a blank line, then its lines without the blank ones closing it. */
function writtenSection(section: Section): string {
  const kept = trimmedLines(section.lines);
  return kept.length === 0
    ? section.written
    : [section.written, '', ...kept].join('\n');
}

/**
 * What `body` holds that {@link parseBugRecord} does not read, as
 * written and in order; `''` for nothing. That is the text ahead of the
 * first heading when a `What` section took its place as the description,
 * every section whose heading names no field, and a section under a
 * field's heading used a second time.
 */
export function otherSections(body: string): string {
  const sorted = sortedBody(body);
  const lead = sorted.lead !== '' && fieldValue(sorted, 'what') !== null
    ? [sorted.lead]
    : [];
  const kept = [...lead, ...sorted.others.map(writtenSection)];
  return kept.length === 0
    ? ''
    : `${kept.join('\n\n')}\n`;
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
