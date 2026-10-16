/**
 * The steps that fill a bug record which `rafa issue create --type=bug`
 * (`../commands/issue/create-bug.ts`) and triage both need: the checkout
 * a bug's files are read in, the redaction of the free-text fields, the
 * settling of a record and the draft built from it (#991). They sit here,
 * outside `src/commands/`, so triage reaches them without crossing the
 * commands boundary (`src/tests/commands-direction.sweep.test.ts`).
 *
 * ## The checkout
 *
 * A project's root is its MAIN checkout, where `.rafa/config.yaml`
 * lives, and a command run from a worktree resolves to it. The code that
 * failed is the worktree's, so the path, the package and the commit are
 * read in the checkout the command runs in: {@link checkoutOf} takes the
 * top level `git` answers from the directory rafa runs in. A top level
 * that holds the project root is no worktree: it is the repository the
 * project is a folder of, or a home that is itself a repository, and the
 * project root is read then, as it is outside any repository. Reading
 * the top level there would name the outer repository's package.
 *
 * ## Redaction and settling
 *
 * {@link redacted} passes every free text of a record through the
 * caller's redactor; composing it, local paths then named secrets, is
 * the caller's. {@link settled} then adds what rafa says itself: the
 * artifact cut to {@link ARTIFACT_MAX_LINES} lines, the error line from
 * the artifact's first line, the summary as the description when none
 * was given, and module `unassigned`, the tracker's word, read as
 * `unknown`.
 *
 * ## The draft
 *
 * The title is rendered from the fields, and the body is the record's
 * sections, then the sections of the body file that are no field of the
 * record (`Expected`, `Refs`), redacted and kept as written
 * ({@link bodyOf}). The draft's module is the record's, `unassigned` for
 * `unknown`, so the board's `module:` label keeps its convention, and
 * its `cause` is the record's, which the tracker files as a label
 * ({@link draftOf}).
 */
import type { BugRecord, BugRules } from './record.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { IssueDraft } from '@open-tomato/rafa/ports';

import { isInside } from '../project/package-of.js';
import { TRIAGE_MODULE } from '../triage/triage.js';

import { bugTitle, hasBugSections, otherSections, renderBugBody } from './record.js';
import { UNKNOWN_VALUE } from './title.js';
import { errorLineOf } from './versions.js';

/** The most lines of an artifact a bug is filed with. */
export const ARTIFACT_MAX_LINES = 60;

/** The fields holding free text, which is redacted before it is filed. */
export const FREE_TEXT_FIELDS: readonly (keyof BugRecord)[] = [
  'summary', 'what', 'reproduce', 'rerun', 'errorLine', 'artifact', 'suspected', 'project',
];

/**
 * The checkout a bug's files are read in: the top level `git` answers
 * when it is a worktree apart from the project root, and `root` outside
 * a repository or under a top level that holds it. See the module note.
 */
export function checkoutOf(git: GitRunner, root: string): string {
  const toplevel = git(['rev-parse', '--show-toplevel']);
  const path = toplevel.stdout.trim();
  return toplevel.ok && path !== '' && !isInside(path, root)
    ? path
    : root;
}

/** `record` with each free text ({@link FREE_TEXT_FIELDS}) passed through `redact`. */
export function redacted(record: BugRecord, redact: (text: string) => string): BugRecord {
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
export function settled(record: BugRecord): BugRecord {
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
export function bodyOf(record: BugRecord, typed: string, redact: (text: string) => string): string {
  const own = renderBugBody(record);
  const others = hasBugSections(typed)
    ? redact(otherSections(typed))
    : '';
  return others === ''
    ? own
    : `${own}\n${others}`;
}

/** The draft a checked record is filed as; see the module note. */
export function draftOf(base: IssueDraft, record: BugRecord, rules: BugRules, body: string): IssueDraft {
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
