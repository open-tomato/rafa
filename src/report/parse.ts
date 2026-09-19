/**
 * The task report: the `rafa:report` block a task session ends its final
 * message with, read out of the session's captured output.
 *
 * `runClaudeCaptured` answers a session's stdout, which under `claude -p`
 * is the session's final message. The message ends with one fenced block
 * the loop acts on:
 *
 * ````markdown
 * ```rafa:report
 * status: done
 * feedback: |
 *   What was done and how it went, one block.
 * findings:
 *   - trigger: "when running bun test under a fresh worktree"
 *     kind: gotcha
 *     what: "node_modules is absent after fork"
 *     cause: "worktree creation does not run bun install"
 *     resolution: "run bun install before the first test"
 *     artifact: "Cannot find package"
 *     signal: loud
 * skills_used: [git-workflow]
 * blockers:
 *   - what: "LINEAR_API_KEY unset"
 *     artifact: "401 Unauthorized"
 * out_of_scope_bugs:
 *   - what: "..."
 *     artifact: "..."
 *     security: false
 * changes:
 *   - level: patch
 *     area: "loop"
 *     summary: "the loop waits for the running task's commit"
 * ```
 * ````
 *
 * {@link parseReport} is the whole interface. It takes any string, never
 * throws, and answers either the report or an explicit record of why
 * there is none. The prompt asks for the block and the loop has to live
 * without it, so a missing report is an answer here, not an exception.
 *
 * ## Which block is read
 *
 * Blocks are found by `readRafaBlocks`, so fences follow its rules: a
 * `rafa:report` fence that does not open its line is prose quoting the
 * syntax, and a report illustrated inside a longer fence is that fence's
 * body. Blocks of every other kind are ignored.
 *
 * Only the LAST `rafa:report` block counts. Anything earlier is a draft
 * the final block replaces, or the session quoting the format while it
 * works. When the last block cannot be read, no earlier one is read in
 * its place: that would record a report the session had already replaced.
 *
 * ## Absence
 *
 * {@link ReportAbsent.reason} says why there is no report:
 *
 *   - `no-block`: the output holds no `rafa:report` block.
 *   - `unclosed-block`: the last block is never closed. It is not read,
 *     because a body cut short can still be valid YAML, just with the
 *     later findings missing. Reading it would shorten the findings list
 *     without anyone noticing.
 *   - `malformed-block`: the last block's body is not valid YAML, or is
 *     not a mapping. An empty body is not a mapping either.
 *
 * Every reason but `no-block` carries the block, so its raw body reaches
 * whoever records the absence.
 *
 * ## Fields
 *
 * A readable block answers a {@link TaskReport}, plus
 * {@link ReportPresent.issues} for whatever it did not read as written.
 * The rules are the ones `plan/parse.ts` applies to a plan header.
 *
 *   - An UNKNOWN key, at the top level or inside an entry, is retained in
 *     that level's `extras` and acts on nothing. This is the rule
 *     `utils/declaration.ts` applies to an unrecognised key, for the same
 *     reason: a report written for a later phase must not break this one.
 *   - A known key that is absent, or set to null, says nothing. When the
 *     field is required, that is a `missing-field` issue.
 *   - A known key whose value is unusable is left null and reported as
 *     `unusable-field`. That covers a string field holding something
 *     other than a string or only whitespace, a closed-set field holding
 *     a value outside {@link REPORT_STATUSES}, {@link FINDING_KINDS},
 *     {@link FINDING_SIGNALS} or {@link CHANGE_LEVELS}, and a `security`
 *     flag that is not a boolean. The sets are closed because stored rows
 *     are keyed on them. A later phase promotes a `silent` finding on its
 *     first sighting, for example, so a signal spelled any other way must
 *     not reach the store looking meaningful.
 *   - A list field holding something other than a list reads as empty,
 *     and is reported. A list entry that is not a mapping, or a
 *     `skills_used` entry that is not a usable string, is dropped and
 *     reported under its index.
 *
 * Required fields: `status`; a finding's `trigger`, `kind`, `what` and
 * `signal`; a blocker's `what`; an out-of-scope bug's `what` and
 * `security`; a change note's `level` and `summary`. A missing `security`
 * flag stays null rather than defaulting to false, because this parser
 * does not get to decide that a bug has no security impact.
 *
 * ## Change notes
 *
 * `changes` is the list of changelog lines a task returns for its own
 * diff. A note's `summary` is one line a user of the project would
 * understand, and its `area` is the short free-text heading the changelog
 * groups it under. Its `level` says how much of a release the change is
 * worth, one of {@link CHANGE_LEVELS}: a task whose diff a user would
 * notice nothing of writes `level: none`, and a task with nothing to say
 * at all omits the list. An absent list is exactly that — empty, with no
 * issue — because a note the task did not write is not one to invent.
 *
 * {@link CHANGE_LEVELS} is spelled in the order the spec writes it and
 * carries no ranking. Whatever computes a release level out of a plan's
 * notes orders them itself; reading precedence off this list's indices
 * would make `none` the highest of the four.
 *
 * Strings are kept exactly as written, never trimmed. `artifact` is the
 * byte string a recurrence is matched on. A blank one is refused, because
 * every blank artifact would dedupe into one finding.
 *
 * Nothing is deduped or summarised. Every usable entry is carried, in
 * order, duplicates included. Deduping is the findings writer's job: by
 * `artifact` when present, otherwise by exact `trigger` plus `what`.
 *
 * An issue's `field` is a path in the report's own key names
 * (`findings[2].signal`, `skills_used[0]`), so it can be found in the
 * block as written. Issues come in the order {@link TaskReport} lists its
 * fields, with each entry's fields in the order its type lists them.
 *
 * ## The parser, measured on bun 1.3.14
 *
 * `Bun.YAML.parse` reads the body. A report is written by a model and
 * quotes error messages, which is where these readings bite:
 *
 *   - A `#` after a space opens a comment, so `artifact: error #42 here`
 *     reads as `"error"`. That loses bytes without an error and cannot be
 *     detected here. Only quoting prevents it.
 *   - An unquoted value that opens with a backtick, `@`, `%` or `[`, or
 *     that holds `: `, throws. One unquoted error message makes the whole
 *     block `malformed-block`, losing every finding in it.
 *   - The `SyntaxError` message names no line, so the block's `span` is
 *     the only location an absence can give.
 *   - `artifact: 404` and `artifact: 0042` read as numbers (the second as
 *     42), and `.inf` as `Infinity`. A number is refused rather than
 *     turned back into a string that may differ from the one written.
 *   - `security: yes` reads as the string `"yes"`, which is refused, and
 *     `security: False` reads as the boolean false.
 *   - A `feedback: |` block keeps one trailing newline. Feedback is kept
 *     as parsed.
 *   - A body with a `---` separator reads as a LIST of documents, so it
 *     is `malformed-block`. A duplicated key keeps its last value and
 *     leaves no trace, so nothing here can report it.
 *   - A key spelled `__proto__` or `constructor` is an ordinary own key.
 *     Keys are matched against a list of names, never looked up by
 *     object index, so such a key lands in `extras`.
 */
import type { RafaBlock } from '../plan/blocks.js';

import { readRafaBlocks } from '../plan/blocks.js';

/** What a session says of its own task. The loop's outcome is separate. */
export const REPORT_STATUSES = ['done', 'blocked'] as const;

/** One of the two statuses a report can claim. */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What a finding is about. */
export const FINDING_KINDS = ['gotcha', 'pattern', 'location', 'skill-suggestion'] as const;

/** One of the four finding kinds. */
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Whether a finding surfaced as a failure, or passed while wrong. */
export const FINDING_SIGNALS = ['loud', 'silent'] as const;

/** One of the two finding signals. */
export type FindingSignal = (typeof FINDING_SIGNALS)[number];

/** How much of a release one change note is worth. */
export const CHANGE_LEVELS = ['patch', 'minor', 'major', 'none'] as const;

/** One of the four change levels. */
export type ChangeLevel = (typeof CHANGE_LEVELS)[number];

/** One key the parser does not know, at whatever level it was written. */
export interface ReportExtra {
  /** The key as written. */
  readonly key: string;
  /**
   * The value exactly as the parser returned it. Never serialised here:
   * a YAML alias can share it with another value.
   */
  readonly value: unknown;
}

/** One `findings` entry. */
export interface ReportFinding {
  /** When the finding surfaced. Required. */
  readonly trigger: string | null;
  /** What the finding is about. Required. */
  readonly kind: FindingKind | null;
  /** The finding itself. Required. */
  readonly what: string | null;
  /** Why it happens. */
  readonly cause: string | null;
  /** What resolves it. */
  readonly resolution: string | null;
  /** The byte string a recurrence would match on. */
  readonly artifact: string | null;
  /** Whether it failed loudly or passed silently. Required. */
  readonly signal: FindingSignal | null;
  /** Every key that names no field. */
  readonly extras: readonly ReportExtra[];
}

/** One `blockers` entry. */
export interface ReportBlocker {
  /** What blocked the task. Required. */
  readonly what: string | null;
  /** The byte string that showed it. */
  readonly artifact: string | null;
  /** Every key that names no field. */
  readonly extras: readonly ReportExtra[];
}

/** One `out_of_scope_bugs` entry. */
export interface ReportBug {
  /** The bug. Required. */
  readonly what: string | null;
  /** The byte string that showed it. */
  readonly artifact: string | null;
  /** Whether the bug has a security impact. Required; never defaulted. */
  readonly security: boolean | null;
  /** Every key that names no field. */
  readonly extras: readonly ReportExtra[];
}

/** One `changes` entry: a changelog line, as the task wrote it. */
export interface ReportChange {
  /** How much of a release the change is worth. Required. */
  readonly level: ChangeLevel | null;
  /** The short heading the changelog groups the line under. */
  readonly area: string | null;
  /** One line a user of the project would understand. Required. */
  readonly summary: string | null;
  /** Every key that names no field. */
  readonly extras: readonly ReportExtra[];
}

/** A `rafa:report` block, read. */
export interface TaskReport {
  /** The session's claim for its task. Required. */
  readonly status: ReportStatus | null;
  /** What was done and how it went, as parsed. */
  readonly feedback: string | null;
  /** Every usable `findings` entry, in order, none merged. */
  readonly findings: readonly ReportFinding[];
  /** Every usable `skills_used` entry, in order. */
  readonly skillsUsed: readonly string[];
  /** Every usable `blockers` entry, in order. */
  readonly blockers: readonly ReportBlocker[];
  /** Every usable `out_of_scope_bugs` entry, in order. */
  readonly outOfScopeBugs: readonly ReportBug[];
  /** Every usable `changes` entry, in order. */
  readonly changes: readonly ReportChange[];
  /** Every top-level key that names no field. */
  readonly extras: readonly ReportExtra[];
}

/** Why a field was not read as written. */
export type ReportIssueReason =
  /** A required field that is absent or null. */
  | 'missing-field'
  /** A value the field cannot hold. Left null, or dropped from its list. */
  | 'unusable-field';

/** One thing the report said that the model does not hold as written. */
export interface ReportIssue {
  /** What went unread, and why. */
  readonly reason: ReportIssueReason;
  /** Where, in the report's own key names: `findings[2].signal`. */
  readonly field: string;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** Why a session output answers no report. */
export type ReportAbsenceReason =
  /** The output holds no `rafa:report` block. */
  | 'no-block'
  /** The last `rafa:report` block is never closed. */
  | 'unclosed-block'
  /** The last `rafa:report` block is not YAML, or not a mapping. */
  | 'malformed-block';

/** A session output whose last `rafa:report` block was read. */
export interface ReportPresent {
  readonly present: true;
  /** The report. */
  readonly report: TaskReport;
  /** The block it was read from: the last `rafa:report` in the output. */
  readonly block: RafaBlock;
  /** What was not read as written. Empty for a clean report. */
  readonly issues: readonly ReportIssue[];
}

/** A session output that answers no report, and why. */
export interface ReportAbsent {
  readonly present: false;
  /** Why there is no report. */
  readonly reason: ReportAbsenceReason;
  /** The last `rafa:report` block, raw body included, or null for `no-block`. */
  readonly block: RafaBlock | null;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** What {@link parseReport} answers: a report, or why there is none. */
export type ReportReading = ReportPresent | ReportAbsent;

/** A plain mapping, as the parser returns one. */
type Mapping = Readonly<Record<string, unknown>>;

/** One mapping being read: its known fields, its extras, and where it sits. */
interface Scope {
  /** The known keys' values, looked up by name, never by object index. */
  readonly fields: ReadonlyMap<string, unknown>;
  /** Every key that names no field. */
  readonly extras: readonly ReportExtra[];
  /** The path its field names are appended to: `''` or `findings[2].`. */
  readonly prefix: string;
  /** Where every issue found reading the report goes. */
  readonly issues: ReportIssue[];
}

/** Reads one list entry, or answers null after reporting why it is dropped. */
type EntryReader<T> = (item: unknown, field: string, issues: ReportIssue[]) => T | null;

/** The block kind a report is read from. */
const REPORT_KIND = 'report';

/** For readability at each field: whether the report must carry it. */
const REQUIRED = true;
const OPTIONAL = false;

/** The report's own keys. */
const REPORT_KEYS = [
  'status',
  'feedback',
  'findings',
  'skills_used',
  'blockers',
  'out_of_scope_bugs',
  'changes',
];

/** A finding's keys. */
const FINDING_KEYS = ['trigger', 'kind', 'what', 'cause', 'resolution', 'artifact', 'signal'];

/** A blocker's keys. */
const BLOCKER_KEYS = ['what', 'artifact'];

/** An out-of-scope bug's keys. */
const BUG_KEYS = ['what', 'artifact', 'security'];

/** A change note's keys. */
const CHANGE_KEYS = ['level', 'area', 'summary'];

/** True for a mapping; false for a list, a scalar or null. */
function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` is one of `choices`. */
function isOneOf<T extends string>(choices: readonly T[], value: unknown): value is T {
  return (choices as readonly unknown[]).includes(value);
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

/** One issue. */
function reportIssue(reason: ReportIssueReason, field: string, text: string): ReportIssue {
  return { reason, field, text };
}

/** One absence. */
function absent(reason: ReportAbsenceReason, block: RafaBlock | null, text: string): ReportAbsent {
  return { present: false, reason, block, text };
}

/** Splits a mapping into the fields `keys` names and the extras it does not. */
function scopeOf(
  mapping: Mapping,
  keys: readonly string[],
  prefix: string,
  issues: ReportIssue[],
): Scope {
  const fields = new Map<string, unknown>();
  const extras: ReportExtra[] = [];
  for (const [key, value] of Object.entries(mapping)) {
    if (keys.includes(key)) fields.set(key, value);
    else extras.push({ key, value });
  }
  return { fields, extras, prefix, issues };
}

/**
 * A field's value, or null when it is absent or null, reporting a
 * required one as missing.
 */
function valueOf(scope: Scope, key: string, required: boolean): unknown {
  const value = scope.fields.get(key) ?? null;
  if (value === null && required) {
    const field = `${scope.prefix}${key}`;
    scope.issues.push(reportIssue('missing-field', field, `${field} is missing`));
  }
  return value;
}

/** Reports a value the field cannot hold. */
function unusable(scope: Scope, key: string, why: string): null {
  const field = `${scope.prefix}${key}`;
  scope.issues.push(reportIssue('unusable-field', field, `${field} ${why}`));
  return null;
}

/** Why a value is no usable string, or null when it is one. */
function stringProblem(value: unknown): string | null {
  if (typeof value !== 'string') return `is ${describeValue(value)}, not a string; quote it`;
  if (value.trim().length === 0) return 'is blank';
  return null;
}

/** A string field, kept as written. */
function stringField(scope: Scope, key: string, required: boolean): string | null {
  const value = valueOf(scope, key, required);
  if (value === null) return null;
  const problem = stringProblem(value);
  return problem === null
    ? value as string
    : unusable(scope, key, problem);
}

/** A field holding one of a closed set of words. */
function choiceField<T extends string>(
  scope: Scope,
  key: string,
  choices: readonly T[],
  required: boolean,
): T | null {
  const value = valueOf(scope, key, required);
  if (value === null || isOneOf(choices, value)) return value;
  return unusable(scope, key, `is ${describeValue(value)}, not one of ${choices.join(', ')}`);
}

/** A boolean field. A string spelling one is refused. */
function booleanField(scope: Scope, key: string, required: boolean): boolean | null {
  const value = valueOf(scope, key, required);
  if (value === null || typeof value === 'boolean') return value;
  return unusable(scope, key, `is ${describeValue(value)}, not true or false; write it unquoted`);
}

/** A list field, each entry read by `readEntry`. Absent or null reads as empty. */
function listField<T>(scope: Scope, key: string, readEntry: EntryReader<T>): T[] {
  const value = valueOf(scope, key, OPTIONAL);
  if (value === null) return [];
  if (!Array.isArray(value)) {
    unusable(scope, key, `is ${describeValue(value)}, not a list`);
    return [];
  }

  const entries: T[] = [];
  const items: readonly unknown[] = value;
  for (const [index, item] of items.entries()) {
    const entry = readEntry(item, `${scope.prefix}${key}[${index}]`, scope.issues);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/**
 * The scope of one list entry, or null after reporting an entry that is
 * not a mapping.
 */
function entryScope(
  item: unknown,
  field: string,
  keys: readonly string[],
  issues: ReportIssue[],
): Scope | null {
  if (isMapping(item)) return scopeOf(item, keys, `${field}.`, issues);
  const text = `${field} is ${describeValue(item)}, not a mapping of ${keys.join(', ')}; dropped`;
  issues.push(reportIssue('unusable-field', field, text));
  return null;
}

/** One `skills_used` entry. */
function readSkill(item: unknown, field: string, issues: ReportIssue[]): string | null {
  const problem = stringProblem(item);
  if (problem === null) return item as string;
  issues.push(reportIssue('unusable-field', field, `${field} ${problem}; dropped`));
  return null;
}

/** One `findings` entry. */
function readFinding(item: unknown, field: string, issues: ReportIssue[]): ReportFinding | null {
  const scope = entryScope(item, field, FINDING_KEYS, issues);
  if (scope === null) return null;
  return {
    trigger: stringField(scope, 'trigger', REQUIRED),
    kind: choiceField(scope, 'kind', FINDING_KINDS, REQUIRED),
    what: stringField(scope, 'what', REQUIRED),
    cause: stringField(scope, 'cause', OPTIONAL),
    resolution: stringField(scope, 'resolution', OPTIONAL),
    artifact: stringField(scope, 'artifact', OPTIONAL),
    signal: choiceField(scope, 'signal', FINDING_SIGNALS, REQUIRED),
    extras: scope.extras,
  };
}

/** One `blockers` entry. */
function readBlocker(item: unknown, field: string, issues: ReportIssue[]): ReportBlocker | null {
  const scope = entryScope(item, field, BLOCKER_KEYS, issues);
  if (scope === null) return null;
  return {
    what: stringField(scope, 'what', REQUIRED),
    artifact: stringField(scope, 'artifact', OPTIONAL),
    extras: scope.extras,
  };
}

/** One `out_of_scope_bugs` entry. */
function readBug(item: unknown, field: string, issues: ReportIssue[]): ReportBug | null {
  const scope = entryScope(item, field, BUG_KEYS, issues);
  if (scope === null) return null;
  return {
    what: stringField(scope, 'what', REQUIRED),
    artifact: stringField(scope, 'artifact', OPTIONAL),
    security: booleanField(scope, 'security', REQUIRED),
    extras: scope.extras,
  };
}

/** One `changes` entry. */
function readChange(item: unknown, field: string, issues: ReportIssue[]): ReportChange | null {
  const scope = entryScope(item, field, CHANGE_KEYS, issues);
  if (scope === null) return null;
  return {
    level: choiceField(scope, 'level', CHANGE_LEVELS, REQUIRED),
    area: stringField(scope, 'area', OPTIONAL),
    summary: stringField(scope, 'summary', REQUIRED),
    extras: scope.extras,
  };
}

/** Reads the report's fields out of a parsed block body. */
function readReport(document: Mapping, issues: ReportIssue[]): TaskReport {
  const scope = scopeOf(document, REPORT_KEYS, '', issues);
  return {
    status: choiceField(scope, 'status', REPORT_STATUSES, REQUIRED),
    feedback: stringField(scope, 'feedback', OPTIONAL),
    findings: listField(scope, 'findings', readFinding),
    skillsUsed: listField(scope, 'skills_used', readSkill),
    blockers: listField(scope, 'blockers', readBlocker),
    outOfScopeBugs: listField(scope, 'out_of_scope_bugs', readBug),
    changes: listField(scope, 'changes', readChange),
    extras: scope.extras,
  };
}

/**
 * Reads the last `rafa:report` block out of a session's captured output.
 *
 * Takes any string, normally `CapturedSession.stdout`. Answers the report
 * with an issue for everything not read as written, or an absence naming
 * why there is none. Never throws. See the module note for which block
 * counts and how each field is read.
 */
export function parseReport(output: string): ReportReading {
  const reports = readRafaBlocks(output).filter((block) => block.kind === REPORT_KIND);
  const block = reports.at(-1);
  if (block === undefined) {
    return absent('no-block', null, 'the session output holds no rafa:report block');
  }

  const line = block.span.first;
  if (!block.closed) {
    return absent(
      'unclosed-block',
      block,
      `rafa:report block at line ${line} is never closed, so its body may have been cut short `
        + 'and is not read',
    );
  }

  let document: unknown;
  try {
    document = Bun.YAML.parse(block.body);
  } catch (error) {
    const text = `rafa:report block at line ${line} is not valid YAML (${messageOf(error)})`;
    return absent('malformed-block', block, text);
  }
  if (!isMapping(document)) {
    const text = `rafa:report block at line ${line} holds ${describeValue(document)}, `
      + 'not a mapping of report fields';
    return absent('malformed-block', block, text);
  }

  const issues: ReportIssue[] = [];
  const report = readReport(document, issues);
  return { present: true, report, block, issues };
}
