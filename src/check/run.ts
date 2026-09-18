/**
 * The checker: the five checks in order over one file or one whole
 * directory, and the count of failing files the CLI exits with.
 *
 * `src/check/layout.ts` answers where a file sits, `src/schema/skill.ts`
 * and `src/schema/instinct.ts` answer what its frontmatter says, and
 * `src/check/references.ts` answers whether its body names anything the
 * reader cannot reach. None of them reads a file. This module is the
 * one that does: it opens the file once, runs all four over the bytes
 * it got, and flattens their four issue shapes into one
 * {@link CheckIssue} a printer can walk without knowing which module
 * produced which.
 *
 * ## The order, and why every check still runs
 *
 * {@link CHECK_STAGES} is the spec's order: layout, schema, resolution,
 * locality, and for an instinct the instinct schema last. A file that
 * fails an earlier check STILL runs the later ones, so one run names
 * every failure of a file rather than the first — and the file counts
 * ONCE towards the exit code however many it has. The issues are
 * stable-sorted by stage at the end, so a report reads in the spec's
 * order while each check's own field order survives inside its stage.
 *
 * Two of the five stages come from one module: `references.ts` answers
 * resolution and locality in a single pass, and {@link LOCALITY_CODES}
 * is the split — `home-path` and `foreign-path` are locality, the rest
 * is resolution.
 *
 * The `schema` stage is the skill schema and the `instinct` stage is
 * the instinct one, so exactly one of the two is ever non-empty. They
 * are separate stages rather than one because the spec numbers them
 * separately and because their codes overlap: `missing-field` at
 * `schema` is a skill's and at `instinct` is a record's.
 *
 * ## What the exit code counts
 *
 * The number of FAILING entries, capped at {@link FAILING_FILE_CAP}.
 * Warnings never count, which is the whole reason
 * {@link CheckIssue.severity} is carried this far: a user tier checked
 * with no project root is full of `unchecked-path`, and a skills
 * directory with a `.DS_Store`-only subdirectory carries
 * `dotfile-only-directory`, and neither may redden a run.
 *
 * An entry is not always a file. A directory holding no `SKILL.md` and
 * a path `stat` refuses are findings about something that is not a
 * file, and both are failures, so both count. {@link CheckReport.isFile}
 * is how a printer tells them apart.
 *
 * ## `--fix` fills two fields and nothing else
 *
 * {@link fixableFields} returns non-null only when EVERY failure of a
 * file is a missing `tags` or a missing `stack`. A file that also has
 * a description over the cap, a dead body path or a name that is not
 * its directory's is left alone: the fix is for the backfill's first
 * step, where the judgement fields come later from a session that reads
 * the body, and a file with anything else wrong is not the backfill's
 * business yet.
 *
 * The write goes through `src/schema/frontmatter.ts`, so the body
 * survives byte for byte and every other key keeps its place. The
 * report returned is the RE-CHECK of what was written, not the check
 * that decided to write: a fix that somehow produced a failing file
 * says so, and {@link CheckReport.fixed} names the fields it filled.
 *
 * Inference is deliberately dull. `stack` is {@link inferStacks} over
 * the body — its fenced languages and the file extensions it names —
 * falling back to `[agnostic]`, which is the honest answer for a body
 * that mentions no language. `tags` are free text, so
 * {@link inferredTags} takes the skill name's hyphen tokens and adds
 * the inferred stacks; the name is the one thing every fixable file
 * certainly has, because a file missing `name` is not fixable.
 *
 * ## Nothing enters a tier unchecked
 *
 * {@link checkFile} is the law's one entry point: every later writer
 * (the demotion pass, the backfill) calls it on its own output and
 * refuses a failing write. A writer checks a path it chose rather than
 * a path a scan handed it, so {@link checkFile} called without an
 * `entry` synthesises one from the path — and adds the checker's own
 * `unregistered-path`, which is the layout rule a single path CAN
 * answer: a skill that is not named `SKILL.md` registers nothing
 * wherever it sits. The rules that need the surrounding directory (the
 * flat grouped and nested layouts) are {@link checkDirectory}'s, which
 * passes the scan's entry and so never runs that rule twice.
 */
import type { CheckKind, LayoutEntry, LayoutIssue, LayoutIssueCode } from './layout.js';
import type { ReferenceIssue, ReferenceIssueCode, ReferenceSeams } from './references.js';
import type { InstinctIssue, InstinctIssueCode } from '../schema/instinct.js';
import type { SkillIssue, SkillIssueCode } from '../schema/skill.js';
import type { StackValue } from '../schema/stack.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { mergeFrontmatter, readFrontmatterDocument, writeFrontmatter } from '../schema/frontmatter.js';
import { parseInstinct } from '../schema/instinct.js';
import { checkSkillFrontmatter } from '../schema/skill.js';
import { AGNOSTIC_STACK, inferStacks } from '../schema/stack.js';

import { MARKDOWN_EXTENSION, SKILL_FILE, declaredNameIssue, scanLayout } from './layout.js';
import { checkReferences } from './references.js';

/**
 * The highest exit code a run can report. A process exit code is one
 * byte, so 255 failing files and 4,000 exit alike; the report says how
 * many there really were.
 */
export const FAILING_FILE_CAP = 255;

/** Which of the five checks produced an issue. */
export type CheckStage = 'layout' | 'schema' | 'resolution' | 'locality' | 'instinct';

/** The stages in the order they run, which is the order they report. */
export const CHECK_STAGES: readonly CheckStage[] = [
  'layout',
  'schema',
  'resolution',
  'locality',
  'instinct',
];

/** Whether an issue counts towards the exit code. */
export type CheckSeverity = 'failure' | 'warning';

/**
 * The reference codes that are locality rather than resolution. One
 * module answers both stages, and this is where the two part.
 */
export const LOCALITY_CODES: readonly ReferenceIssueCode[] = ['home-path', 'foreign-path'];

/**
 * The codes the checker itself owns, which no check module produces.
 *
 * `missing-frontmatter` is spelled the way `schema/instinct.ts` spells
 * its own, because it is the same finding: the skill schema has no such
 * code (it reads a mapping, not a file), so the checker reports it for
 * a skill and the instinct schema reports it for a record.
 */
export const CHECKER_ISSUE_CODES = [
  'unreadable-file',
  'missing-frontmatter',
  'unregistered-path',
] as const;

/** A code the checker owns; see {@link CHECKER_ISSUE_CODES}. */
export type CheckerIssueCode = typeof CHECKER_ISSUE_CODES[number];

/** Every code any stage can report. A code is read with its stage. */
export type CheckIssueCode =
  | LayoutIssueCode
  | SkillIssueCode
  | ReferenceIssueCode
  | InstinctIssueCode
  | CheckerIssueCode;

/** One rule broken, whichever check broke it. */
export interface CheckIssue {
  /** Which check produced it. */
  readonly stage: CheckStage;
  /** Which rule was broken. */
  readonly code: CheckIssueCode;
  /** Whether it counts towards the exit code. */
  readonly severity: CheckSeverity;
  /**
   * The frontmatter field or body heading at fault, or null for a rule
   * that is about the file rather than one of its fields.
   */
  readonly field: string | null;
  /** The 1-based line in the BODY, or null for a rule with no line. */
  readonly line: number | null;
  /** A sentence a printer writes unedited. */
  readonly message: string;
}

/** Everything the five checks said about one path. */
export interface CheckReport {
  /** Which directory it was checked as. */
  readonly kind: CheckKind;
  /** The path checked, as it was passed in or as the scan found it. */
  readonly path: string;
  /** Whether {@link CheckReport.path} is a file that was opened. */
  readonly isFile: boolean;
  /** The name its place implies, or null when its place implies none. */
  readonly name: string | null;
  /** Every rule broken, in {@link CHECK_STAGES} order. */
  readonly issues: readonly CheckIssue[];
  /** Whether any issue is a failure, so whether it counts. */
  readonly failed: boolean;
  /** The fields `--fix` filled, empty when it filled none. */
  readonly fixed: readonly string[];
}

/** Everything the five checks said about one directory. */
export interface DirectoryReport {
  /** Which directory was checked. */
  readonly kind: CheckKind;
  /** The directory, as it was passed in. */
  readonly root: string;
  /** One report per entry the layout scan found, in path order. */
  readonly reports: readonly CheckReport[];
  /** How many entries failed, uncapped. */
  readonly failingFiles: number;
  /** {@link DirectoryReport.failingFiles} capped at {@link FAILING_FILE_CAP}. */
  readonly exitCode: number;
}

/** The seams a run resolves against, and the one switch it carries. */
export interface CheckOptions {
  /**
   * The project a body is consumed in, or null for a tier that has
   * none, which makes every project path a warning.
   */
  readonly projectRoot: string | null;
  /** The directories a command name is looked up in, in order. */
  readonly pathDirs: readonly string[];
  /** Whether to fill `tags` and `stack` on a file that only lacks them. */
  readonly fix?: boolean;
}

/** {@link CheckOptions} plus the entry a scan already made for a path. */
export interface FileCheckOptions extends CheckOptions {
  /**
   * The layout entry {@link scanLayout} produced for this path. Given
   * one, {@link checkFile} trusts its classification and skips the
   * `unregistered-path` rule the scan has already answered.
   */
  readonly entry?: LayoutEntry;
}

/** The two fields `--fix` fills, in the order it writes them. */
export const FIXABLE_FIELDS: readonly string[] = ['tags', 'stack'];

/** Whether any of `issues` counts towards the exit code. */
export function hasCheckFailure(issues: readonly CheckIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'failure');
}

/** `count` as an exit code: itself, or {@link FAILING_FILE_CAP}. */
export function failureExitCode(count: number): number {
  return Math.min(count, FAILING_FILE_CAP);
}

/** A layout issue as a checker issue. */
function fromLayout(issue: LayoutIssue): CheckIssue {
  return {
    stage: 'layout',
    code: issue.code,
    severity: issue.severity,
    field: null,
    line: null,
    message: issue.message,
  };
}

/** A skill schema issue as a checker issue; every one is a failure. */
function fromSkill(issue: SkillIssue): CheckIssue {
  return {
    stage: 'schema',
    code: issue.code,
    severity: 'failure',
    field: issue.field,
    line: null,
    message: issue.message,
  };
}

/** An instinct schema issue as a checker issue; every one is a failure. */
function fromInstinct(issue: InstinctIssue): CheckIssue {
  return {
    stage: 'instinct',
    code: issue.code,
    severity: 'failure',
    field: issue.field,
    line: null,
    message: issue.message,
  };
}

/** A reference issue as a checker issue, at whichever stage owns its code. */
function fromReference(issue: ReferenceIssue): CheckIssue {
  return {
    stage: LOCALITY_CODES.includes(issue.code)
      ? 'locality'
      : 'resolution',
    code: issue.code,
    severity: issue.severity,
    field: null,
    line: issue.reference.line,
    message: issue.message,
  };
}

/** One issue the checker itself owns. */
function checkerIssue(
  stage: CheckStage,
  code: CheckerIssueCode,
  message: string,
): CheckIssue {
  return { stage, code, severity: 'failure', field: null, line: null, message };
}

/** Whether `name` is a markdown file name. */
function isMarkdown(name: string): boolean {
  return name.endsWith(MARKDOWN_EXTENSION);
}

/**
 * The layout entry a lone path implies, for a {@link checkFile} called
 * outside a directory scan.
 *
 * The shape is the registered one when the path is in it and
 * `loose-file` otherwise, because a single path cannot tell a flat
 * grouped layout from a loose file — only the scan's root can. The
 * NAME is what this is really for: a skill's is its directory's and a
 * record's is its file stem, which is what {@link declaredNameIssue}
 * compares the frontmatter against.
 */
export function fileEntry(path: string, kind: CheckKind): LayoutEntry {
  const base = basename(path);
  const stem = isMarkdown(base)
    ? base.slice(0, -MARKDOWN_EXTENSION.length)
    : base;

  if (kind === 'instinct') {
    return {
      kind,
      path,
      isFile: true,
      shape: isMarkdown(base)
        ? 'instinct-file'
        : 'loose-file',
      name: stem,
      issues: [],
    };
  }

  return base === SKILL_FILE
    ? { kind, path, isFile: true, shape: 'skill-file', name: basename(dirname(path)), issues: [] }
    : { kind, path, isFile: true, shape: 'loose-file', name: stem, issues: [] };
}

/**
 * The one layout rule a lone path can answer: a skill registers only
 * as `SKILL.md`, and a record is only read as markdown. Null when the
 * path is in the shape that registers.
 */
function unregisteredIssue(path: string, kind: CheckKind): CheckIssue | null {
  const base = basename(path);

  if (kind === 'instinct') {
    return isMarkdown(base)
      ? null
      : checkerIssue(
        'layout',
        'unregistered-path',
        `${base} is not a ${MARKDOWN_EXTENSION} file, so it is no instinct record`,
      );
  }

  return base === SKILL_FILE
    ? null
    : checkerIssue(
      'layout',
      'unregistered-path',
      `${base} is not a ${SKILL_FILE}, so it registers no skill wherever it sits`,
    );
}

/**
 * The skill's own directory, for the resolution seam: the directory a
 * `SKILL.md` sits in, and null for anything else. A flat grouped
 * `<dir>/<group>/<name>.md` shares its directory with its siblings, so
 * it has no directory of its own and names no scripts.
 */
function skillDirectoryOf(entry: LayoutEntry): string | null {
  if (entry.kind !== 'skill' || !entry.isFile) return null;
  return basename(entry.path) === SKILL_FILE
    ? dirname(entry.path)
    : null;
}

/** The string at `key`, or null when it is absent or another type. */
function stringAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string'
    ? value
    : null;
}

/** `issues` in {@link CHECK_STAGES} order, each stage's order kept. */
function inStageOrder(issues: readonly CheckIssue[]): CheckIssue[] {
  return [...issues].sort(
    (left, right) => CHECK_STAGES.indexOf(left.stage) - CHECK_STAGES.indexOf(right.stage),
  );
}

/**
 * The fields `--fix` may fill on this file, or null when it may fill
 * none: every failure has to be a missing `tags` or a missing `stack`,
 * and there has to be at least one. Warnings are ignored, which is why
 * a user-tier skill full of `unchecked-path` is still fixable.
 */
export function fixableFields(issues: readonly CheckIssue[]): readonly string[] | null {
  const failures = issues.filter((issue) => issue.severity === 'failure');
  if (failures.length === 0) return null;

  const found = new Set<string>();
  for (const failure of failures) {
    if (failure.stage !== 'schema' || failure.code !== 'missing-field') return null;
    if (failure.field === null || !FIXABLE_FIELDS.includes(failure.field)) return null;
    found.add(failure.field);
  }

  return FIXABLE_FIELDS.filter((field) => found.has(field));
}

/**
 * The `stack` a body implies: the languages its fences and file
 * extensions name, or `[agnostic]` when it names none.
 */
export function inferredStack(body: string): readonly StackValue[] {
  const stacks = inferStacks(body);
  return stacks.length > 0
    ? stacks
    : [AGNOSTIC_STACK];
}

/**
 * The `tags` a skill implies: its name's hyphen tokens, then the
 * stacks its body implies, each once and in that order. Tags are free
 * text, so this is a floor a backfill session can widen, not a
 * vocabulary.
 */
export function inferredTags(name: string, body: string): readonly string[] {
  const tags = new Set<string>();
  for (const token of name.split('-')) {
    if (token !== '') tags.add(token);
  }
  for (const stack of inferStacks(body)) tags.add(stack);
  return [...tags];
}

/** The report for a layout entry that is not a file to open. */
function entryReport(entry: LayoutEntry): CheckReport {
  const issues = entry.issues.map(fromLayout);
  return {
    kind: entry.kind,
    path: entry.path,
    isFile: false,
    name: entry.name,
    issues,
    failed: hasCheckFailure(issues),
    fixed: [],
  };
}

/** The report for a path `readFileSync` refused. */
function unreadableReport(entry: LayoutEntry, reason: string): CheckReport {
  const issues = [checkerIssue(
    'layout',
    'unreadable-file',
    `the file cannot be read (${reason})`,
  )];
  return {
    kind: entry.kind,
    path: entry.path,
    isFile: true,
    name: entry.name,
    issues,
    failed: true,
    fixed: [],
  };
}

/** The schema stage for a skill, plus the layout rule that needs the file. */
function skillIssues(
  entry: LayoutEntry,
  document: ReturnType<typeof readFrontmatterDocument>,
): CheckIssue[] {
  if (document === null) {
    return [checkerIssue(
      'schema',
      'missing-frontmatter',
      'the file opens with no --- block holding a YAML mapping',
    )];
  }

  const mismatch = declaredNameIssue(entry, stringAt(document.data, 'name'));
  return [
    ...checkSkillFrontmatter(document.data).map(fromSkill),
    ...mismatch === null
      ? []
      : [fromLayout(mismatch)],
  ];
}

/** The instinct stage, plus the layout rule that needs the file. */
function instinctIssues(
  entry: LayoutEntry,
  text: string,
  document: ReturnType<typeof readFrontmatterDocument>,
): CheckIssue[] {
  const mismatch = document === null
    ? null
    : declaredNameIssue(entry, stringAt(document.data, 'id'));

  return [
    ...parseInstinct(text).issues.map(fromInstinct),
    ...mismatch === null
      ? []
      : [fromLayout(mismatch)],
  ];
}

/**
 * Fills `fields` on the file at `path` and answers the re-check of
 * what was written. The body is untouched: the write goes through
 * `writeFrontmatter`, which reassembles the file from its own bytes.
 */
function applyFix(
  path: string,
  kind: CheckKind,
  options: FileCheckOptions,
  document: NonNullable<ReturnType<typeof readFrontmatterDocument>>,
  fields: readonly string[],
): CheckReport {
  const body = document.body;
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === 'tags') changes[field] = inferredTags(stringAt(document.data, 'name') ?? '', body);
    if (field === 'stack') changes[field] = inferredStack(body);
  }

  writeFileSync(path, writeFrontmatter(document, mergeFrontmatter(document.data, changes)), 'utf8');

  const rechecked = checkFile(path, kind, { ...options, fix: false });
  return { ...rechecked, fixed: fields };
}

/**
 * The five checks over one file, in order, with every one of them run
 * whatever the earlier ones said.
 *
 * `options.entry` is the layout entry a scan already made for this
 * path; without one an entry is synthesised from the path and the
 * checker's own `unregistered-path` rule runs. With `options.fix` set,
 * a file whose ONLY failures are a missing `tags` or `stack` is
 * rewritten and the report is the re-check of what was written.
 */
export function checkFile(
  path: string,
  kind: CheckKind,
  options: FileCheckOptions,
): CheckReport {
  const entry = options.entry ?? fileEntry(path, kind);

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return unreadableReport(entry, error instanceof Error
      ? error.message
      : String(error));
  }

  const document = readFrontmatterDocument(text);
  const body = document?.body ?? text;
  const placement = options.entry === undefined
    ? unregisteredIssue(path, kind)
    : null;

  const seams: ReferenceSeams = {
    projectRoot: options.projectRoot,
    skillDir: skillDirectoryOf(entry),
    pathDirs: options.pathDirs,
  };

  const issues = inStageOrder([
    ...entry.issues.map(fromLayout),
    ...placement === null
      ? []
      : [placement],
    ...kind === 'skill'
      ? skillIssues(entry, document)
      : instinctIssues(entry, text, document),
    ...checkReferences(body, seams).issues.map(fromReference),
  ]);

  const fields = options.fix === true && kind === 'skill' && document !== null
    ? fixableFields(issues)
    : null;
  if (fields !== null && document !== null) {
    return applyFix(path, kind, options, document, fields);
  }

  return {
    kind,
    path,
    isFile: true,
    name: entry.name,
    issues,
    failed: hasCheckFailure(issues),
    fixed: [],
  };
}

/**
 * The five checks over every entry of one directory, in path order.
 *
 * The layout scan decides what there is to check, so a directory that
 * registers nothing is reported without being opened and a file the
 * scan classified is checked with that classification. `failingFiles`
 * counts each failing entry once however many rules it broke, and
 * warnings never reach it.
 *
 * A missing directory THROWS, as `scanLayout` does: an empty answer is
 * what a wrong path and an empty tier both look like.
 */
export function checkDirectory(
  root: string,
  kind: CheckKind,
  options: CheckOptions,
): DirectoryReport {
  const scan = scanLayout(root, kind);
  const reports = scan.entries.map((entry) => (entry.isFile
    ? checkFile(entry.path, kind, { ...options, entry })
    : entryReport(entry)));
  const failingFiles = reports.filter((report) => report.failed).length;

  return {
    kind,
    root,
    reports,
    failingFiles,
    exitCode: failureExitCode(failingFiles),
  };
}
