/**
 * A bug filed through `rafa issue create --type=bug` (#951): the record
 * read from the line, what rafa fills itself, the check, and the draft.
 *
 * ## How a bug line is read
 *
 * In this order, each step over the one before:
 *
 *  1. **The body.** A body holding a section of the record
 *     (`hasBugSections`, `../../bugs/record.ts`) is parsed into fields;
 *     any other body is the description, the `What` field.
 *  2. **The flags**, each winning over its section: `--module`,
 *     `--action`, `--summary`, `--env`, `--cause`, `--proposed`,
 *     `--reproduce`, `--rerun` and `--project`.
 *  3. **A `--title`**, read back through the project's template. A field
 *     it holds that a flag or the body also gave must say the same, or
 *     the line is refused; a field only the title gives is taken from it.
 *  4. **The defaults.** Module `unassigned`, the tracker's word, is read
 *     as `unknown`. The description is the summary when none was given.
 *     The place is the one rafa suggests (`../../bugs/places.ts`).
 *  5. **The path**, read BEFORE anything is redacted, since redaction
 *     takes local paths out: `--path`, else the first file of the
 *     checkout the artifact names, else the first the error line names.
 *     The package is the one that file belongs to
 *     (`../../project/package-of.ts`), or the checkout's own with no file.
 *  6. **Redaction** of every free text, local paths then named secrets,
 *     as triage composes the two (`../../triage/triage.ts`).
 *  7. **What rafa says itself:** the artifact cut to
 *     {@link ARTIFACT_MAX_LINES} lines, the error line from the
 *     artifact's first line, and the `Versions` section, which replaces
 *     one a body file carries.
 *  8. **The check** (`bugProblems`). A record with a problem is refused
 *     with exit code 1, every problem on a line of its own, before any
 *     tracker is resolved.
 *
 * ## The checkout
 *
 * A project's root is its MAIN checkout, where `.rafa/config.yaml`
 * lives, and a command run from a worktree resolves to it. The code that
 * failed is the worktree's, so the path, the package and the commit are
 * read in the checkout the command runs in: the top level `git` answers
 * from the directory rafa runs in ({@link IssueSeams.cwd}), or the
 * project root outside a repository. Both paths are taken out of the
 * text, the checkout's first: it lies under the root when it is a
 * worktree there, and the root taken out first would leave the
 * worktree's folders behind.
 *
 * ## The draft
 *
 * The title is rendered from the fields, and the body is the record's
 * sections, then the sections of the body file that are no field of the
 * record (`Expected`, `Refs`), redacted and kept as written. The draft's
 * module is the record's, `unassigned` for `unknown`, so the board's
 * `module:` label keeps its convention, and its `cause` is the record's,
 * which the tracker files as a label.
 *
 * The config is read here, before the chain resolves it again. Its
 * warnings are written through `warn`, which the caller silences when
 * the chain will write them for the same config.
 */
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { BugRecord, BugRules } from '../../bugs/record.js';
import type { RafaContext } from '../../cli/command.js';
import type { IssueDraft } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';

import { relative, resolve } from 'node:path';

import { suggestedEnvironment } from '../../bugs/places.js';
import {
  bugProblems,
  bugTitle,
  EMPTY_BUG_RECORD,
  hasBugSections,
  otherSections,
  parseBugRecord,
  renderBugBody,
} from '../../bugs/record.js';
import { firstProjectPath } from '../../bugs/stack-path.js';
import { parseTitle, UNKNOWN_VALUE } from '../../bugs/title.js';
import { codeVersionOf, errorLineOf, versionsText } from '../../bugs/versions.js';
import { RAFA_VERSION } from '../../cli/version.js';
import { bugRulesOf } from '../../config-schema-issues.js';
import { createGitRunner } from '../../pr/git.js';
import { isInside, packageOf, rootPackageOf } from '../../project/package-of.js';
import { localPathRedactor } from '../../triage/local-paths.js';
import { namedSecrets, redactSecrets, TRIAGE_MODULE } from '../../triage/triage.js';

import { issueProject, issueSubjectConfig, lineRefusal, readNonBlankFlag } from './issue-tracker.js';

/** The flags only a bug line reads; `--module` and `--title` are every type's. */
export const BUG_FLAGS = ['summary', 'action', 'env', 'cause', 'proposed', 'reproduce', 'rerun', 'project', 'path'] as const;

/** The most lines of an artifact a bug is filed with. */
export const ARTIFACT_MAX_LINES = 60;

/** The field each flag fills. `--path` fills none: it names the file the versions are read for. */
const FLAG_FIELDS: readonly (readonly [flag: string, field: keyof BugRecord])[] = [
  ['module', 'module'],
  ['action', 'action'],
  ['summary', 'summary'],
  ['env', 'environment'],
  ['cause', 'cause'],
  ['proposed', 'proposed'],
  ['reproduce', 'reproduce'],
  ['rerun', 'rerun'],
  ['project', 'project'],
];

/** The fields a title is read back into. */
const TITLE_FIELDS = ['module', 'action', 'summary'] as const;

/** The fields holding free text, which is redacted before it is filed. */
const FREE_TEXT_FIELDS: readonly (keyof BugRecord)[] = [
  'summary', 'what', 'reproduce', 'rerun', 'errorLine', 'artifact', 'suspected', 'project',
];

/** What a bug line makes: the draft to file, and the record it was rendered from. */
export interface BugLine {
  readonly draft: IssueDraft;
  readonly record: BugRecord;
}

/** How a bug line is read beside its flags. */
export interface BugLineOptions {
  /** The usage line a refusal names. */
  readonly usage: string;
  /** Where the config's warnings go; see the module note. */
  readonly warn: (message: string) => void;
}

/** A text with something in it, or null. */
function textOrNull(text: string): string | null {
  return text.trim() === ''
    ? null
    : text;
}

/** The record a body holds: its sections, or the whole of it as the description. */
function recordOfBody(body: string): BugRecord {
  return hasBugSections(body)
    ? parseBugRecord(body)
    : { ...EMPTY_BUG_RECORD, what: textOrNull(body) };
}

/** `record` with each field a flag of the line names laid over it. */
function withFlags(record: BugRecord, flags: LineFlags, usage: string): BugRecord {
  const given = FLAG_FIELDS.flatMap(([flag, field]) => {
    const value = readNonBlankFlag(flags, flag, usage);
    return value === undefined
      ? []
      : [[field, value] as const];
  });
  return { ...record, ...Object.fromEntries(given) };
}

/**
 * `record` with the fields `title` holds under `template`; a refusal
 * for a title the template cannot hold and one that disagrees with a
 * field already given. See the module note.
 */
function withTitle(record: BugRecord, title: string, template: string, usage: string): BugRecord {
  if (title === '') return record;
  const read = parseTitle(template, title);
  if (read === null) {
    throw lineRefusal(`--title does not fit the title template ${JSON.stringify(template)}: pass the fields, and rafa renders the title`, usage);
  }
  const taken = TITLE_FIELDS.flatMap((field) => {
    const titled = read[field] ?? null;
    const given = record[field];
    if (titled === null) return [];
    if (given !== null && given !== titled) {
      throw lineRefusal(`--title reads ${field} as ${JSON.stringify(titled)}, and --${field} says ${JSON.stringify(given)}`, usage);
    }
    return [[field, titled] as const];
  });
  return { ...record, ...Object.fromEntries(taken) };
}

/** The checkout `git` runs in, or `root` outside a repository; see the module note. */
function checkoutOf(git: GitRunner, root: string): string {
  const toplevel = git(['rev-parse', '--show-toplevel']);
  const path = toplevel.stdout.trim();
  return toplevel.ok && path !== ''
    ? path
    : root;
}

/** The file the versions are read for, relative to the checkout `root`, or null; a refusal for a `--path` outside it. */
function pathOf(record: BugRecord, flags: LineFlags, root: string, usage: string): string | null {
  const typed = readNonBlankFlag(flags, 'path', usage);
  if (typed === undefined) {
    return firstProjectPath(record.artifact ?? '', root) ?? firstProjectPath(record.errorLine ?? '', root);
  }
  const absolute = resolve(root, typed);
  if (!isInside(root, absolute)) throw lineRefusal(`--path is outside the project: ${JSON.stringify(typed)}`, usage);
  return relative(root, absolute);
}

/** `record` with each free text passed through `redact`. */
function redacted(record: BugRecord, redact: (text: string) => string): BugRecord {
  return {
    ...record,
    ...Object.fromEntries(FREE_TEXT_FIELDS.flatMap((field) => {
      const value = record[field];
      return value === null
        ? []
        : [[field, redact(value)] as const];
    })),
  };
}

/** `artifact` cut to {@link ARTIFACT_MAX_LINES} lines, a last line saying how many were left out. */
export function cappedArtifact(artifact: string): string {
  const lines = artifact.split(/\r?\n/);
  const cut = lines.length - ARTIFACT_MAX_LINES;
  return cut <= 0
    ? artifact
    : [...lines.slice(0, ARTIFACT_MAX_LINES), `… ${cut} more lines cut`].join('\n');
}

/** `record` with what rafa says itself: the capped artifact, the error line, the description and the module's word. */
function settled(record: BugRecord): BugRecord {
  const artifact = record.artifact === null
    ? null
    : cappedArtifact(record.artifact);
  const derived = artifact === null
    ? null
    : errorLineOf(artifact);
  return {
    ...record,
    artifact,
    errorLine: record.errorLine ?? derived,
    what: record.what ?? record.summary,
    module: record.module === TRIAGE_MODULE
      ? UNKNOWN_VALUE
      : record.module,
  };
}

/** The body a bug is filed with: the record's sections, then the body's other sections, redacted. */
function bodyOf(record: BugRecord, typed: string, redact: (text: string) => string): string {
  const own = renderBugBody(record);
  const others = hasBugSections(typed)
    ? redact(otherSections(typed))
    : '';
  return others === ''
    ? own
    : `${own}\n${others}`;
}

/** The draft a checked record is filed as; see the module note. */
function draftOf(base: IssueDraft, record: BugRecord, rules: BugRules, body: string): IssueDraft {
  return {
    ...base,
    title: bugTitle(record, rules),
    body,
    module: record.module === null || record.module === UNKNOWN_VALUE
      ? TRIAGE_MODULE
      : record.module,
    ...record.cause === null
      ? {}
      : { cause: record.cause },
  };
}

/**
 * The draft a bug line makes from `base`, the draft its flags of every
 * type made, its title `''` for a line naming none; a refusal with exit
 * code 1 naming every problem of the record. See the module note.
 */
export function readBugLine(context: RafaContext, seams: IssueSeams, base: IssueDraft, options: BugLineOptions): BugLine {
  const { usage, warn } = options;
  const project = issueProject(context);
  const config = issueSubjectConfig(project, warn);
  const rules = bugRulesOf(config);
  const git = seams.git ?? createGitRunner((seams.cwd ?? ((): string => process.cwd()))());
  const checkout = checkoutOf(git, project.root);
  const inCheckout = localPathRedactor(checkout, project.home);
  const inProject = localPathRedactor(project.root, project.home);
  const secrets = namedSecrets(config, context.env);
  const redact = (text: string): string => redactSecrets(inProject(inCheckout(text)), secrets);

  const typed = withTitle(withFlags(recordOfBody(base.body), context.flags, usage), base.title, rules.template, usage);
  const path = pathOf(typed, context.flags, checkout, usage);
  const owner = path === null
    ? rootPackageOf(checkout)
    : packageOf(path, checkout);
  const record: BugRecord = {
    ...settled(redacted(typed, redact)),
    environment: typed.environment ?? suggestedEnvironment(context.env),
    versions: versionsText({
      rafa: RAFA_VERSION,
      code: codeVersionOf(git),
      owner,
      path,
    }),
  };

  const problems = bugProblems(record, rules);
  if (problems.length > 0) {
    throw lineRefusal(['the bug record is not complete:', ...problems.map((problem) => `  ${problem}`)].join('\n'), usage);
  }
  return { draft: draftOf(base, record, rules, bodyOf(record, base.body, redact)), record };
}
