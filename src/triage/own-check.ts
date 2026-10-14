/**
 * The kind check ({@link checkKind}): what kind of leftover an
 * `out_of_scope_bugs` entry is, read from what the plan's commits did
 * rather than taken from the session. The session that reports a red
 * test is not the one that turned it red, and it cannot see the plan's
 * base, so the loop checks every `own-` claim and finds the ones a
 * session called `bug`.
 *
 * The check is pure: it takes the entry, the base and head readings of
 * the test it names and the plan's files, and runs nothing. The caller
 * reads the test it names with {@link namedTestOf}, runs it on the
 * plan's base and head (`runNamedTestAt`, `./base-run.ts`) and reads the
 * files (`readPlanFiles`, `./plan-commits.ts`).
 *
 * ## The decision table
 *
 * An entry the session said is `convention`, `docs` or `machine` is taken
 * as said, and nothing else is read. One it said is `bug`, `own-fallout`
 * or `own-gap` is read down the table, the first row that holds
 * answering:
 *
 * | The entry | Answer |
 * | --- | --- |
 * | names a test case, its head reading not `red` | `bug` |
 * | names a test case, not run on the base | `bug` |
 * | names a test case, `red` on the base and the head | inherited (`bug`) |
 * | names a test case, `green` on the base, `red` on the head | `own-fallout` |
 * | names no test case, and the plan's files were not read | `bug` |
 * | names no test case, a path outside the plan's files | `bug` |
 * | names no test case, every path one of the plan's files | `own-gap` |
 * | names neither a test case nor a path | the kind as said |
 *
 * So an `own-` claim the check does not confirm is read as `bug`, and a
 * `bug` the check finds the plan's own is read as its `own-` kind. An
 * inherited entry is unfiled as a run-start failure is today; it is
 * answered as `bug` with `inherited` set, since no kind is the plan's.
 *
 * **A test case is named** when `testFailureOf` (`./test-failure.ts`)
 * reads one from the entry. A case it reads with no test file cannot be
 * run on the base, and neither can one the caller gave no readings for:
 * both take the "not run on the base" row.
 *
 * **Every path, not any:** an entry is `own-gap` only when every path it
 * names (`pathsNamedIn`, `./doc-only.ts`, over its `what` and
 * `artifact`) is one of the plan's files, since `own-gap` reaches only
 * files the plan's own commits touched; an entry naming one of them and
 * a neighbour's file is a `bug`. A piece of prose with a `/` in it
 * (`and/or`) is read as a path there too, and makes the entry a `bug`:
 * the cost falls on filing, never on hiding.
 *
 * **A named path is one of the plan's files** when, a leading `./` taken
 * off, it equals one; or it is absolute and ends in `/` and one, as a
 * stack frame names a file of the checkout; or it is a bare file name, no
 * `/` in it, and one of the plan's files has that base name.
 */
import type { BaseRunAnswer, NamedTest } from './base-run.js';
import type { PlanFilesReading } from './plan-commits.js';
import type { BugKind, ReportBug } from '../report/parse.js';

import { basename, isAbsolute } from 'node:path';

import { pathsNamedIn } from './doc-only.js';
import { testFailureOf } from './test-failure.js';

/** The kinds the check reads down its table; any other is taken as said. */
const CHECKED_KINDS: readonly BugKind[] = ['bug', 'own-fallout', 'own-gap'];

/** The entry's fields the check reads. */
export type KindCheckEntry = Pick<ReportBug, 'what' | 'artifact' | 'kind'>;

/** The named test's readings on the plan's base and on its head. */
export interface NamedTestReadings {
  /** The case on the plan's base. */
  readonly base: BaseRunAnswer;
  /** The case on the head. */
  readonly head: BaseRunAnswer;
}

/** What {@link checkKind} reads: the entry, its test's readings and the plan's files. */
export interface KindCheckInput {
  /** The entry, as the report parser read it. */
  readonly entry: KindCheckEntry;
  /**
   * The readings of the test {@link namedTestOf} answers for the entry,
   * or null when it answers none or the test was not run. Not read for
   * an entry that names no test case.
   */
  readonly readings: NamedTestReadings | null;
  /** The plan's files, as `readPlanFiles` read them. */
  readonly planFiles: PlanFilesReading;
}

/** The row of the decision table that answered; see the module note. */
export type KindCheckRow =
  /** Said `convention`, `docs` or `machine`. */
  | 'as-said'
  /** A test case named, its head reading not `red`. */
  | 'head-not-red'
  /** A test case named, not run on the base. */
  | 'base-unrunnable'
  /** A test case named, `red` on the base and the head. */
  | 'red-on-both'
  /** A test case named, `green` on the base and `red` on the head. */
  | 'fallout'
  /** No test case named, the plan's files not read. */
  | 'files-unread'
  /** No test case named, a path outside the plan's files. */
  | 'file-outside-plan'
  /** No test case named, every path one of the plan's files. */
  | 'plan-files'
  /** Neither a test case nor a path named. */
  | 'nothing-named';

/** What {@link checkKind} answers. */
export interface KindCheck {
  /** The kind the entry is routed under. */
  readonly kind: BugKind;
  /** Whether the entry is a failure the plan's base already held; its kind is then `bug`. */
  readonly inherited: boolean;
  /** The row that answered. */
  readonly row: KindCheckRow;
  /** One sentence saying why. */
  readonly reason: string;
}

/** An answer of `kind` from `row`, not inherited. */
function answer(kind: BugKind, row: KindCheckRow, reason: string): KindCheck {
  return { kind, inherited: false, row, reason };
}

/**
 * The test the entry names, with its file, for the caller to run on the
 * plan's base and head; null when it names no test case, or a case with
 * no test file.
 */
export function namedTestOf(entry: Pick<ReportBug, 'what' | 'artifact'>): NamedTest | null {
  const failure = testFailureOf(entry);
  if (failure === null || failure.file === null) return null;
  return { file: failure.file, name: failure.name };
}

/** `reading`'s problem sentence, or the answer it gave. */
function saidOf(reading: BaseRunAnswer): string {
  return reading.answer === 'unrunnable'
    ? reading.problem
    : `It was ${reading.answer}.`;
}

/** The table's test rows, for an entry naming the case `name`; see the module note. */
function checkTest(name: string, readings: NamedTestReadings | null): KindCheck {
  if (readings === null) {
    return answer('bug', 'base-unrunnable', `The case ${name} was not run on the plan's base, so it reads as a bug.`);
  }
  const { base, head } = readings;
  if (head.answer !== 'red') {
    return answer('bug', 'head-not-red', `The case ${name} is not red on the head, so it reads as a bug. ${saidOf(head)}`);
  }
  if (base.answer === 'unrunnable') {
    return answer('bug', 'base-unrunnable', `The case ${name} could not be run on the plan's base, so it reads as a bug. ${base.problem}`);
  }
  if (base.answer === 'red') {
    return {
      kind: 'bug',
      inherited: true,
      row: 'red-on-both',
      reason: `The case ${name} is red on the plan's base and its head, so the plan inherited it.`,
    };
  }
  return answer('own-fallout', 'fallout', `The case ${name} is green on the plan's base and red on its head.`);
}

/** `path` with any leading `./` taken off. */
function withoutDotSlash(path: string): string {
  return path.replace(/^(?:\.\/)+/, '');
}

/** Whether the named `path` is one of `files`; see the module note. */
function isPlanFile(path: string, files: readonly string[]): boolean {
  const named = withoutDotSlash(path);
  if (files.includes(named)) return true;
  if (isAbsolute(named)) return files.some((file) => named.endsWith(`/${file}`));
  return !named.includes('/') && files.some((file) => basename(file) === named);
}

/** The table's file rows, for an entry naming no test case; see the module note. */
function checkFiles(entry: KindCheckEntry, planFiles: PlanFilesReading): KindCheck {
  const paths = pathsNamedIn(`${entry.what ?? ''}\n${entry.artifact ?? ''}`);
  if (paths.length === 0) {
    return answer(entry.kind, 'nothing-named', 'The entry names no test case and no path, so it is taken as said.');
  }
  if (!planFiles.ok) {
    return answer('bug', 'files-unread', `The plan's files were not read, so it reads as a bug. ${planFiles.problem}`);
  }
  const outside = paths.find((path) => !isPlanFile(path, planFiles.files));
  if (outside !== undefined) {
    return answer('bug', 'file-outside-plan', `${outside} is not one of the plan's files, so it reads as a bug.`);
  }
  return answer('own-gap', 'plan-files', 'Every path the entry names is one of the plan\'s files.');
}

/**
 * The kind the entry is routed under, read down the decision table of the
 * module note from the readings of the test it names and the plan's
 * files. Pure: it runs no test and no git.
 */
export function checkKind(input: KindCheckInput): KindCheck {
  const { entry } = input;
  if (!CHECKED_KINDS.includes(entry.kind)) {
    return answer(entry.kind, 'as-said', `The kind ${entry.kind} is not checked, so it is taken as said.`);
  }
  const failure = testFailureOf(entry);
  if (failure === null) return checkFiles(entry, input.planFiles);
  return checkTest(failure.name, failure.file === null
    ? null
    : input.readings);
}
