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
 *     A relative `--path` is read from the directory rafa runs in, as
 *     `--body-file` is, and refused when it lies outside the checkout or
 *     names no file. The package is the one that file belongs to
 *     (`../../project/package-of.ts`), or the checkout's own with no file.
 *  6. **Redaction** of every free text (`redacted`,
 *     `../../bugs/fill.ts`), local paths then named secrets, as triage
 *     composes the two (`../../triage/triage.ts`).
 *  7. **What rafa says itself** (`settled`, `../../bugs/fill.ts`): the
 *     artifact cut to `ARTIFACT_MAX_LINES` lines, the error line from
 *     the artifact's first line, and the `Versions` section, which
 *     replaces one a body file carries.
 *  8. **The check** (`bugProblems`). A record with a problem is refused
 *     with exit code 1, every problem on a line of its own, before any
 *     tracker is resolved.
 *
 * ## The checkout
 *
 * The path, the package and the commit are read in the checkout the
 * command runs in, which `checkoutOf` (`../../bugs/fill.ts`, whose note
 * holds the rule) reads from the directory rafa runs in
 * ({@link IssueSeams.cwd}), never in the project root a worktree
 * resolves to.
 *
 * Both roots are taken out of the text in ONE pass
 * (`localPathRedactor`, `../../triage/local-paths.ts`), the longer
 * first. Two passes would leave the folders between the home and the
 * project in a path under the main checkout.
 *
 * ## The draft
 *
 * The draft is built by `bodyOf` and `draftOf` (`../../bugs/fill.ts`,
 * whose note holds the title, the body, the module and the cause they
 * file).
 *
 * The config is read here, before the chain resolves it again. Its
 * warnings are written through `warn`, which the caller silences when
 * the chain will write them for the same config.
 */
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { BugRecord } from '../../bugs/record.js';
import type { RafaContext } from '../../core/command/index.js';
import type { IssueDraft } from '../../ports/index.js';

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { bodyOf, checkoutOf, draftOf, redacted, settled } from '../../bugs/fill.js';
import { suggestedEnvironment } from '../../bugs/places.js';
import { bugProblems, EMPTY_BUG_RECORD, hasBugSections, parseBugRecord } from '../../bugs/record.js';
import { firstProjectPath } from '../../bugs/stack-path.js';
import { parseTitle } from '../../bugs/title.js';
import { codeVersionOf, versionsText } from '../../bugs/versions.js';
import { bugRulesOf } from '../../config-schema-issues.js';
import { RAFA_VERSION } from '../../core/command/index.js';
import { createGitRunner } from '../../core/git/index.js';
import { isInside, packageOf, rootPackageOf } from '../../project/package-of.js';
import { localPathRedactor } from '../../triage/local-paths.js';
import { namedSecrets, redactSecrets } from '../../triage/triage.js';

import { issueProject, issueSubjectConfig, lineRefusal, readNonBlankFlag } from './issue-tracker.js';

/** The flags only a bug line reads; `--module` and `--title` are every type's. */
export const BUG_FLAGS = ['summary', 'action', 'env', 'cause', 'proposed', 'reproduce', 'rerun', 'project', 'path'] as const;

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
const TITLE_FIELDS = ['project', 'module', 'action', 'summary'] as const;

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

/** Where a bug line's files are read: the checkout, and the directory rafa runs in. */
interface Places {
  readonly checkout: string;
  readonly cwd: string;
}

/**
 * The file the versions are read for, relative to the checkout, or
 * null; a refusal for a `--path` outside the checkout and for one that
 * names no file. See the module note.
 */
function pathOf(record: BugRecord, flags: LineFlags, places: Places, usage: string): string | null {
  const { checkout, cwd } = places;
  const typed = readNonBlankFlag(flags, 'path', usage);
  if (typed === undefined) {
    return firstProjectPath(record.artifact ?? '', checkout) ?? firstProjectPath(record.errorLine ?? '', checkout);
  }
  const absolute = resolve(cwd, typed);
  if (!isInside(checkout, absolute)) throw lineRefusal(`--path is outside the project: ${JSON.stringify(typed)}`, usage);
  if (!existsSync(absolute)) throw lineRefusal(`--path names no file: ${JSON.stringify(typed)}`, usage);
  return relative(checkout, absolute);
}

/**
 * The draft a bug line makes from `base`, the draft its flags of every
 * type made, its title `''` for a line naming none; a refusal with exit
 * code 1 naming every problem of the record. See the module note.
 */
export async function readBugLine(context: RafaContext, seams: IssueSeams, base: IssueDraft, options: BugLineOptions): Promise<BugLine> {
  const { usage, warn } = options;
  const project = issueProject(context);
  const config = await issueSubjectConfig(project, warn);
  const rules = bugRulesOf(config);
  const cwd = (seams.cwd ?? ((): string => process.cwd()))();
  const git = seams.git ?? createGitRunner(cwd);
  const checkout = checkoutOf(git, project.root);
  const local = localPathRedactor([checkout, project.root], project.home);
  const secrets = namedSecrets(config, context.env);
  const redact = (text: string): string => redactSecrets(local(text), secrets);

  const typed = withTitle(withFlags(recordOfBody(base.body), context.flags, usage), base.title, rules.template, usage);
  const path = pathOf(typed, context.flags, { checkout, cwd }, usage);
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
