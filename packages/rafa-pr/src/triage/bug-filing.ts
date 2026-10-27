/**
 * The bug record a bug the loop files carries (#991): built from what a
 * session reported, the dispatch it ran under and the context triage is
 * handed, so a bug filed by the loop has the record of one filed through
 * `rafa issue create --type=bug` (`context/bug-record.md`).
 *
 * {@link bugFilingOf} takes one `ReportBug`, its `what` already checked
 * to hold text, the dispatch, the report's feedback, the checkout, git
 * runner, environment and record rules triage is handed, and the two
 * redactors triage builds: `local`, which takes local paths out, and
 * `redact`, which takes named secrets out of `local`'s answer. It
 * answers the record, the session's own module and action words beside
 * an `unknown` the record carries for them, and the `BugValues`
 * `./issue-text.ts` renders a body from.
 *
 * ## The fills, in order
 *
 *   1. **What**: the reported `what`, the record's description.
 *   2. **Summary**: that `what` redacted, on one line and cut to the
 *      rules' `summaryMax` (`summaryOf`, `../bugs/filed-values.ts`).
 *   3. **Reproduce**: the session's, else "seen while running task
 *      <task line> of plan <stub>", or "seen while running `<the
 *      command>`" for a dispatch with no plan stub, whose task line is
 *      the command that ran (`rafa epic close <n>`). A blank reproduce
 *      and the word `unknown` are left out: the record never holds
 *      `unknown` there.
 *   4. **The cause rule** over the session's `cause`
 *      (`causeOf`, `../bugs/cause-rule.ts`): the cause, and the code
 *      kept as `proposed` or the words kept as `suspected`.
 *   5. **The boundary rule** over its `module` and `action`
 *      (`boundaryValueOf`, `../bugs/filed-values.ts`): a checked name
 *      or `unknown`, and the word it could not use as `reported`.
 *   6. **Environment**: the place rafa suggests for the run's
 *      environment (`suggestedEnvironment`, `../bugs/places.ts`).
 *   7. **The package**: the first file of the checkout the artifact
 *      names, read BEFORE local paths are taken out
 *      (`firstProjectPath`, `../bugs/stack-path.ts`), and the package it
 *      belongs to, or the checkout's own when the artifact names none
 *      (`packageOf`, `rootPackageOf`, `../project/package-of.ts`).
 *   8. **Versions**: `versionsText` over `RAFA_VERSION`, the checkout's
 *      code version and the package (`../bugs/versions.ts`).
 *
 * Then **Rerun**, for a bug whose `what` and artifact read as a test
 * failure ({@link rerunOf}).
 *
 * ## What is left out
 *
 * The artifact is NOT cut, and no error line is written: the recurrence
 * key holds the same stripped text. The project is null: a report names
 * none.
 *
 * ## The context left out
 *
 * With no git runner the code version is read as no commit, and the
 * `Versions` section says `code: unknown`; nothing is spawned. With no
 * environment the process's own is read, as `TriageOptions.env` is. With
 * no rules, {@link DEFAULT_BUG_RULES}: the default template and cap, no
 * vocabulary and rafa's own codes.
 *
 * ## Redaction
 *
 * Every free text of the record, the reported words among them, has gone
 * through `redact` when it is answered, so a title rendered from the
 * record is redacted already. The cause codes, the module, the action and
 * the place are tokens the rules hold to a shape, and the `Versions`
 * section is rafa's own words over a path relative to the checkout.
 *
 * The `BugValues` keep `./issue-text.ts`'s contract unchanged: `what`
 * as reported and the artifact with local paths taken out, each
 * redacted when a body is rendered, with the key and the `Refs` section
 * the caller built from them.
 */
import type { BugValues, ReportedWords } from './issue-text.js';
import type { BugRecord, BugRules } from '@open-tomato/rafa/bugs/record';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { ReportBug } from '@open-tomato/rafa/report/parse';
import type { FindingsDispatch } from '@open-tomato/rafa/store/findings';

import { suggestedEnvironment } from '@open-tomato/rafa/bugs/places';
import { EMPTY_BUG_RECORD } from '@open-tomato/rafa/bugs/record';
import { firstProjectPath } from '@open-tomato/rafa/bugs/stack-path';
import { UNKNOWN_VALUE } from '@open-tomato/rafa/bugs/title';
import { codeVersionOf, versionsText } from '@open-tomato/rafa/bugs/versions';
import { ERRORS_DEFAULTS } from '@open-tomato/rafa/config-schema-errors';
import { bugRulesOf, ISSUES_DEFAULTS } from '@open-tomato/rafa/config-schema-issues';
import { RAFA_VERSION } from '@open-tomato/rafa/core/command';
import { packageOf, rootPackageOf } from '@open-tomato/rafa/project/package-of';
import { artifactOf, hasText } from '@open-tomato/rafa/triage/bug-key';
import { testFailureOf } from '@open-tomato/rafa/triage/test-failure';
import { causeOf } from '@open-tomato/rafa-board';

import { boundaryValueOf, summaryOf } from '../bugs/filed-values.js';

export type { ReportedWords };

/** The rules a record is built under when triage is handed none; see the module note. */
export const DEFAULT_BUG_RULES: BugRules = bugRulesOf({ ...ISSUES_DEFAULTS, ...ERRORS_DEFAULTS });

/** What separates a test's describe names and its own in the case name `testFailureOf` reads. */
const CASE_PARTS = ' > ';

/** What `bun test -t` matches a test's names joined with. */
const NAME_JOIN = ' ';

/** The context triage is handed for the record (#991): the stage-3 options of `TriageOptions`. */
export interface BugFilingContext {
  /** The checkout the task ran in, where the package is read. */
  readonly checkout: string;
  /** A git runner in the checkout; left out, the code version is `unknown`. */
  readonly git?: GitRunner;
  /** The environment the run sees; the process's own when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The rules the record is built under; {@link DEFAULT_BUG_RULES} when left out. */
  readonly bugRules?: BugRules;
}

/** What {@link bugFilingOf} builds a record from. */
export interface BugFilingInput {
  readonly bug: ReportBug;
  /** The bug's `what`, already checked to hold text. */
  readonly what: string;
  /** The dispatch the report came from. */
  readonly dispatch: FindingsDispatch;
  /** The report's feedback. */
  readonly feedback: string | null;
  /** The key `find` is asked for, redacted, or null; the caller's, from `./bug-key.ts`. */
  readonly key: string | null;
  /** The `Refs` section, or null; the caller's, from `./refs-section.ts`. */
  readonly refs: string | null;
  readonly context: BugFilingContext;
  /** Takes local paths out of a text. */
  readonly local: (text: string) => string;
  /** Takes local paths, then named secrets, out of a text. */
  readonly redact: (text: string) => string;
}

/** What {@link bugFilingOf} answers. */
export interface BugFiling {
  /** The record, its free text redacted; see the module note. */
  readonly record: BugRecord;
  readonly reported: ReportedWords;
  /** The values a body or a comment is rendered from. */
  readonly values: BugValues;
}

/** True for a reproduce worth keeping: text that is not the word `unknown`. */
function isReproduce(reproduce: string | null): reproduce is string {
  return hasText(reproduce) && reproduce.trim().toLowerCase() !== UNKNOWN_VALUE;
}

/** The reproduce a bug is filed with; see the module note. */
export function reproduceOf(reported: string | null, dispatch: FindingsDispatch): string {
  if (isReproduce(reported)) return reported.trim();
  return dispatch.planStub === null
    ? `seen while running \`${dispatch.taskLine}\``
    : `seen while running task ${dispatch.taskLine} of plan ${dispatch.planStub}`;
}

/** `text` matched literally inside a regular expression. */
function regexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `text` inside double quotes, as a POSIX shell reads it back. */
function doubleQuoted(text: string): string {
  return `"${text.replace(/[\\"$`]/g, '\\$&')}"`;
}

/**
 * The command that runs one test case again, for a bug whose `what` and
 * artifact, local paths already taken out, read as a test failure naming
 * its file (`testFailureOf`, `./test-failure.ts`); null for a bug naming
 * no case or no file.
 *
 * `bun test -t` takes a regular expression matched against a test's
 * describe names and its own joined by a space, so the case name's
 * ` > ` is written as a space and the rest is matched literally. Measured
 * on bun 1.3.14: `-t "outer > inner > case"` matches no test. A case
 * whose own name holds ` > ` is read as two names, and matches no test.
 */
export function rerunOf(bug: Pick<ReportBug, 'what' | 'artifact'>): string | null {
  const failure = testFailureOf(bug);
  if (failure === null || failure.file === null) return null;
  const pattern = failure.name.split(CASE_PARTS).map(regexLiteral)
    .join(NAME_JOIN);
  return `bun test ${failure.file} -t ${doubleQuoted(pattern)}`;
}

/** The `Versions` section for a bug whose artifact, as reported, is `artifact`; see the module note. */
function versionsOf(artifact: string | null, context: BugFilingContext): string {
  const { checkout, git } = context;
  const path = artifact === null
    ? null
    : firstProjectPath(artifact, checkout);
  const owner = path === null
    ? rootPackageOf(checkout)
    : packageOf(path, checkout);
  const code = git === undefined
    ? { commit: null, dirty: false }
    : codeVersionOf(git);
  return versionsText({ rafa: RAFA_VERSION, code, owner, path });
}

/** `text` redacted, or null. */
function redactedOrNull(text: string | null, redact: (text: string) => string): string | null {
  return text === null
    ? null
    : redact(text);
}

/** The record, the reported words and the body's values of one bug; see the module note. */
export function bugFilingOf(input: BugFilingInput): BugFiling {
  const { bug, what, dispatch, context, local, redact } = input;
  const rules = context.bugRules ?? DEFAULT_BUG_RULES;
  const reported = artifactOf(bug);
  const artifact = reported === null
    ? null
    : local(reported);

  const module = boundaryValueOf('module', bug.module, rules.modules);
  const action = boundaryValueOf('action', bug.action, rules.actions);
  const cause = causeOf(bug.cause, rules.codes);
  const summary = summaryOf(redact(what), rules.summaryMax, rules.template, {
    type: 'bug',
    module: module.value,
    action: action.value,
  });
  const rerun = rerunOf({ what: local(what), artifact });

  const record: BugRecord = {
    ...EMPTY_BUG_RECORD,
    what: redact(what),
    summary,
    reproduce: redact(reproduceOf(bug.reproduce, dispatch)),
    cause: cause.cause,
    proposed: cause.proposed,
    suspected: redactedOrNull(cause.suspected, redact),
    module: module.value,
    action: action.value,
    environment: suggestedEnvironment(context.env ?? process.env),
    versions: versionsOf(reported, context),
    rerun: redactedOrNull(rerun, redact),
    artifact: redactedOrNull(artifact, redact),
  };
  return {
    record,
    reported: {
      module: redactedOrNull(module.reported, redact),
      action: redactedOrNull(action.reported, redact),
    },
    values: {
      what,
      artifact,
      key: input.key,
      refs: input.refs,
      planStub: dispatch.planStub,
      taskText: dispatch.taskLine,
      feedback: input.feedback,
    },
  };
}
