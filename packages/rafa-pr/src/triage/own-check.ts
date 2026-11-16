/**
 * The kind check ({@link checkKind}): what kind of leftover an
 * `out_of_scope_bugs` entry is, read from what the plan's commits did
 * rather than taken from the session. The session that reports a red
 * test is not the one that turned it red, and it cannot see the plan's
 * base, so the loop checks every `own-` claim and finds the ones a
 * session called `bug`.
 *
 * The check is pure: it takes the entry, the base and head readings of
 * the test it names, the plan's files and the red step captures the
 * runner kept, and runs nothing. The caller reads the test it names with
 * {@link namedTestOf}, runs it on the plan's base and head
 * (`runNamedTestAt`, `./base-run.ts`), reads the files (`readPlanFiles`,
 * `./plan-commits.ts`) and reads the captures (`readKeptCaptures`,
 * `./runner-evidence.ts`).
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
 * | names a test case, `red` on the base and the head | inherited (`bug`) |
 * | names a test case, `green` on the base, `red` on the head | `own-fallout` |
 * | names a test case a kept capture holds | `own-fallout` |
 * | names a test case, its head reading not `red` | `bug` |
 * | names a test case, not run on the base | `bug` |
 * | names no test case, and the plan's files were not read | `bug` |
 * | names no test case nor a test file, a path outside the plan's files, a symbol the plan added | `own-gap` |
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
 * both take the "not run on the base" row, unless a kept capture holds
 * the case.
 *
 * **The step-capture row** reads the runner's own red step captures
 * ({@link KindCheckInput.captures}): the output text a red suite step
 * kept under the commit it ran at, the head or one of the plan's
 * commits. A case one of them holds (`captureHolding`, its name as
 * `testFailureOf` reads it) was red in a step of this plan, so it reads
 * `own-fallout` in place of the "head reading not `red`" and "not run on
 * the base" rows: the step's repair may have turned it green since, and
 * a green rerun writes over the step's `<kind>.output.txt`, but not over
 * the kept capture. It never answers in place of the inherited row: a
 * step's capture holds every red case of the step, the ones the plan's
 * base already held among them. The `fallout` row keeps its row and
 * carries the capture too, and the {@link KindCheck} carries it as
 * `capture`, so the router can join the step repair line for the
 * capture's commit. The file rows read an entry naming no case, which no
 * capture can hold, so the row never reaches them. Captures left out,
 * or none holding the case, leave the table as it read before the row.
 *
 * **Every path, not any:** an entry is `own-gap` only when every file
 * path it names (`pathsNamedIn`, `./doc-only.ts`, over its `what` and
 * `artifact`) is one of the plan's files, since `own-gap` reaches only
 * files the plan's own commits touched; an entry naming one of them and
 * a neighbour's file is a `bug`. A piece whose last segment holds no
 * extension (`packages/rafa-effort`, `context/`, `and/or`, a bare
 * `README`) names no file and is dropped before the file rows are read:
 * a folder is neither one of the plan's files nor outside them, so an
 * entry naming only folders takes the "names neither" row.
 *
 * **A named path is one of the plan's files** when, any leading `./`
 * and `../` taken off, it equals one; or it began with `./` or `../`,
 * as an import specifier does, and the rest is a suffix of one, cut at a
 * `/` (`../base-run.js` reads `packages/rafa-pr/src/triage/base-run.ts`);
 * or it is absolute and ends in `/` and one, as a stack frame names a
 * file of the checkout; or it is a bare file name, no `/` in it, and one
 * of the plan's files has that base name. A path ending in `.js`, `.mjs`
 * or `.jsx` is read both as written and as the `.ts`, `.mts` or `.tsx`
 * file an import specifier with that extension resolves to.
 *
 * **The symbol row** reads only an entry the file rows would answer
 * `file-outside-plan` for: it catches an omission, the file the plan
 * should have touched and did not, which no file row can. The symbols are
 * `symbolsOf`'s (`./symbols.ts`), and one is the plan's when a line of
 * `planFiles.added` holds it at identifier boundaries: a symbol opening
 * or closing with a letter, digit, `_` or `$` matches only where no such
 * character stands beside it, so `TakenBy` is not read in `TakenByRow`.
 * The first symbol the entry names that the plan added answers, and the
 * {@link KindCheck} carries it as `symbol`, for the repair dedupe. The
 * row is skipped, leaving `file-outside-plan`, for an entry naming a test
 * file (`testFilesIn`, `./test-failure.ts`), which is left to the test
 * rows, and when the added lines were not read (`added` null): a reading
 * the loop could not take leaves the table as it read before the row.
 */
import type { BaseRunAnswer, NamedTest } from './base-run.js';
import type { PlanFilesRead, PlanFilesReading } from './plan-commits.js';
import type { KeptCapture } from './runner-evidence.js';
import type { BugKind, ReportBug } from '@open-tomato/rafa/report/parse';

import { basename, extname, isAbsolute } from 'node:path';

import { pathsNamedIn } from '@open-tomato/rafa/triage/doc-only';
import { testFailureOf, testFilesIn } from '@open-tomato/rafa/triage/test-failure';

import { captureHolding } from './runner-evidence.js';
import { symbolsOf } from './symbols.js';

/** The kinds the check reads down its table; any other is taken as said. */
export const CHECKED_KINDS: readonly BugKind[] = ['bug', 'own-fallout', 'own-gap'];

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
  /**
   * The red step captures the runner kept at the head or one of the
   * plan's commits, as `readKeptCaptures` read them; left out, none.
   * Read only for an entry that names a test case.
   */
  readonly captures?: readonly KeptCapture[];
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
  /** A test case named that a kept red step capture holds, not `red` on both. */
  | 'step-capture'
  /** No test case named, the plan's files not read. */
  | 'files-unread'
  /** No test case nor test file named, a path outside the plan's files, a symbol the plan added. */
  | 'plan-symbol'
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
  /** The symbol the `plan-symbol` row matched in the plan's added lines; null from any other row. */
  readonly symbol: string | null;
  /** The kept capture holding the named case, from the `step-capture` and `fallout` rows; else null. */
  readonly capture: KeptCapture | null;
}

/** An answer of `kind` from `row`, not inherited, matching no symbol and carrying no capture. */
function answer(kind: BugKind, row: KindCheckRow, reason: string): KindCheck {
  return { kind, inherited: false, row, reason, symbol: null, capture: null };
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
      symbol: null,
      capture: null,
    };
  }
  return answer('own-fallout', 'fallout', `The case ${name} is green on the plan's base and red on its head.`);
}

/** The characters of a commit a reason shows. */
const SHOWN_COMMIT = 12;

/**
 * The step-capture row over the test rows' answer `tested`, for an entry
 * naming the case `name`: the inherited row stands, a capture holding
 * the case is carried by the `fallout` row and answers in place of any
 * other; see the module note.
 */
function checkCaptured(tested: KindCheck, name: string, captures: readonly KeptCapture[]): KindCheck {
  if (tested.row === 'red-on-both') return tested;
  const capture = captureHolding(captures, name);
  if (capture === null) return tested;
  if (tested.row === 'fallout') return { ...tested, capture };
  const shown = capture.sha.slice(0, SHOWN_COMMIT);
  return {
    ...answer('own-fallout', 'step-capture', `The case ${name} is red in the ${capture.step} step's capture kept at commit ${shown}, so it reads as own-fallout.`),
    capture,
  };
}

/** A leading run of `./` and `../`, as a relative import specifier opens. */
const RELATIVE_PREFIX = /^(?:\.\.?\/)+/;

/** A last segment holding an extension: a `.` with a name after it (`a.ts`, `.gitignore`). */
const HAS_EXTENSION = /\.[^./]+$/;

/** The source extension each emitted one an import specifier spells resolves to. */
const SOURCE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['.js', '.ts'],
  ['.mjs', '.mts'],
  ['.jsx', '.tsx'],
]);

/** Whether `path` names a file: its last segment holds an extension; see the module note. */
function namesFile(path: string): boolean {
  return HAS_EXTENSION.test(path.split('/').at(-1) ?? '');
}

/** `path` as written, and as its source file when it ends in an emitted extension. */
function spellingsOf(path: string): readonly string[] {
  const emitted = extname(path);
  const source = SOURCE_EXTENSIONS.get(emitted);
  return source === undefined
    ? [path]
    : [path, `${path.slice(0, -emitted.length)}${source}`];
}

/** Whether `named`, one spelling of a named path, is one of `files`; see the module note. */
function isPlanSpelling(named: string, relative: boolean, files: readonly string[]): boolean {
  if (files.includes(named)) return true;
  if (relative) return files.some((file) => file.endsWith(`/${named}`));
  if (isAbsolute(named)) return files.some((file) => named.endsWith(`/${file}`));
  return !named.includes('/') && files.some((file) => basename(file) === named);
}

/** Whether the named `path` is one of `files`; see the module note. */
function isPlanFile(path: string, files: readonly string[]): boolean {
  const relative = RELATIVE_PREFIX.test(path);
  const named = path.replace(RELATIVE_PREFIX, '');
  return spellingsOf(named).some((spelling) => isPlanSpelling(spelling, relative, files));
}

/** A letter, digit, `_` or `$`: a character an identifier holds. */
const IDENTIFIER_CHAR = /[\p{L}\p{N}_$]/u;

/** The characters a regular expression reads as syntax. */
const REGEXP_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** A pattern matching `symbol` at identifier boundaries; see the module note. */
function symbolPattern(symbol: string): RegExp {
  const before = IDENTIFIER_CHAR.test(symbol.at(0) ?? '')
    ? '(?<![\\p{L}\\p{N}_$])'
    : '';
  const after = IDENTIFIER_CHAR.test(symbol.at(-1) ?? '')
    ? '(?![\\p{L}\\p{N}_$])'
    : '';
  return new RegExp(`${before}${symbol.replace(REGEXP_SYNTAX, '\\$&')}${after}`, 'u');
}

/** The first symbol the entry names that a line of `added` holds, or null; see the module note. */
function addedSymbolOf(entry: KindCheckEntry, added: readonly string[]): string | null {
  return symbolsOf(entry).find((symbol) => {
    const pattern = symbolPattern(symbol);
    return added.some((line) => pattern.test(line));
  }) ?? null;
}

/**
 * The symbol row, for an entry naming `outside`, a path outside the
 * plan's files: `own-gap` when the plan added a symbol it names, else
 * `file-outside-plan`; see the module note.
 */
function checkOutside(entry: KindCheckEntry, outside: string, planFiles: PlanFilesRead, text: string): KindCheck {
  const outsideAnswer = answer('bug', 'file-outside-plan', `${outside} is not one of the plan's files, so it reads as a bug.`);
  if (planFiles.added === null || testFilesIn(text).length > 0) return outsideAnswer;
  const symbol = addedSymbolOf(entry, planFiles.added);
  if (symbol === null) return outsideAnswer;
  return {
    ...answer('own-gap', 'plan-symbol', `${outside} is not one of the plan's files, but the plan's commits added ${symbol}, so it reads as own-gap.`),
    symbol,
  };
}

/** The table's file rows, for an entry naming no test case; see the module note. */
function checkFiles(entry: KindCheckEntry, planFiles: PlanFilesReading): KindCheck {
  const text = `${entry.what ?? ''}\n${entry.artifact ?? ''}`;
  const paths = pathsNamedIn(text).filter(namesFile);
  if (paths.length === 0) {
    return answer(entry.kind, 'nothing-named', 'The entry names no test case and no path, so it is taken as said.');
  }
  if (!planFiles.ok) {
    return answer('bug', 'files-unread', `The plan's files were not read, so it reads as a bug. ${planFiles.problem}`);
  }
  const outside = paths.find((path) => !isPlanFile(path, planFiles.files));
  if (outside !== undefined) return checkOutside(entry, outside, planFiles, text);
  return answer('own-gap', 'plan-files', 'Every path the entry names is one of the plan\'s files.');
}

/**
 * The kind the entry is routed under, read down the decision table of the
 * module note from the readings of the test it names, the plan's files
 * and the kept captures. Pure: it runs no test and no git, and reads no
 * file.
 */
export function checkKind(input: KindCheckInput): KindCheck {
  const { entry } = input;
  if (!CHECKED_KINDS.includes(entry.kind)) {
    return answer(entry.kind, 'as-said', `The kind ${entry.kind} is not checked, so it is taken as said.`);
  }
  const failure = testFailureOf(entry);
  if (failure === null) return checkFiles(entry, input.planFiles);
  const tested = checkTest(failure.name, failure.file === null
    ? null
    : input.readings);
  return checkCaptured(tested, failure.name, input.captures ?? []);
}
