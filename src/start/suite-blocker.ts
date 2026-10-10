/**
 * What a red suite step writes on the tracker (`suite-step.ts`): the
 * blocker text, and the repair task that carries it.
 *
 * {@link blockerText} names each new failing test file with its count,
 * the command running them (`bun test <files>`), what Bun printed for
 * them, and the errors or the missing summary when those made the step
 * red. What Bun printed is the first error line of each new failure
 * (`suite/failure-lines.ts`), which the JUnit report does not hold:
 * quoted by file, each distinct line once with how many of the file's
 * tests printed it, the first {@link ERROR_LINES_QUOTED} lines of a file
 * and the first {@link ERROR_FILES_QUOTED} files, the rest counted. A
 * file whose failures carry no line is left out of that sentence, and
 * the sentence is left out when none does. Errors outside any test
 * are named by file and first line, as Bun's stderr printed them
 * ({@link unhandledNames}): the JUnit report holds no file for them.
 * The baseline keeps only their count, so every block of the run is
 * named, the inherited ones included. Each path in a `bun test` command
 * is written as {@link runnablePath} spells it, `./` before a relative
 * one: bun reads an argument without `./` or `/` as a substring filter,
 * so a bare `x.test.ts` would also run `a/x.test.ts`.
 *
 * {@link writeRepairTask} puts that text on a repair task. A red task or
 * stage step inserts one through `insertTrackerTask` (`utils/tracker.ts`)
 * directly above the first open plan task, in document order, `[ ]` or
 * `[BLOCKED]`, so it sits under that task's stage heading and the task
 * itself is left as it was. Its line reads
 * `- [BLOCKED] Repair the red <kind> step at commit <sha>  {agent=build-error-resolver}`
 * with the blocker as its comment: the text names the commit the step
 * ran at (twelve characters of it, or `(unread)` when git did not answer
 * HEAD), and {@link REPAIR_AGENT} is the declared agent. Being blocked,
 * it is the line `findNextTask` answers first, so the next run dispatches
 * the repair before anything else, handed the blocker. With no open task
 * left the line goes after the checklist's last task.
 *
 * A red task step that follows a repair task, its task text one
 * {@link isRepairTask} reads, writes its blocker on that repair's own line
 * instead and inserts nothing: the line, ticked by the repair's commit,
 * is opened and marked `[BLOCKED]` again through `writeTrackerBlocker`,
 * its text and the commit it names kept. So a repair that leaves the
 * suite red is retried on its own line, and the tracker never holds two
 * repairs for one red step. Should no line carry that text, a repair is
 * inserted as for any task.
 *
 * A red pre-wrap-up step runs with no open task left, so its repair,
 * `Repair the red pre-wrap-up step at commit <sha>`, goes after the
 * checklist's last task. Should the tracker already hold a ticked
 * pre-wrap-up repair, the last one in document order, a red pre-wrap-up
 * step writes its blocker on that line instead, as a task step does on
 * the repair it followed, and inserts nothing: so one repair session is
 * the most a pre-wrap-up step adds, and a second red is answered as a
 * repair blocked again ({@link RepairWritten.inserted} false), which the
 * caller halts on.
 */
import type { SuiteFailure, SuiteResult } from '../suite/run.js';
import type { UnhandledError } from '../suite/unhandled.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { parsePlan } from '../plan/parse.js';
import { insertTrackerTask, writeTrackerBlocker } from '../utils/tracker.js';

/** A step's failures split against the baseline, and what else can make it red. */
export interface StepVerdict {
  readonly fresh: readonly SuiteFailure[];
  readonly known: readonly SuiteFailure[];
  readonly newErrors: number;
  /** True when Bun exited nonzero and printed no summary. */
  readonly unreported: boolean;
}

/** Each file among `failures` and how many of its tests failed, in first-seen order. */
function failingFiles(failures: readonly SuiteFailure[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const failure of failures) counts.set(failure.file, (counts.get(failure.file) ?? 0) + 1);
  return [...counts.entries()];
}

/** How many distinct error lines of one file the blocker quotes before it counts the rest. */
const ERROR_LINES_QUOTED = 3;

/** How many files' error lines the blocker quotes before it counts the rest. */
const ERROR_FILES_QUOTED = 10;

/** `count` as `1 test` or `N tests`. */
function testCount(count: number): string {
  return `${count} ${count === 1
    ? 'test'
    : 'tests'}`;
}

/** Each distinct first error line among `failures` and how many of them printed it, in first-seen order. */
function firstErrorLines(failures: readonly SuiteFailure[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const line = failure.errorLines?.[0];
    if (line !== undefined) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()];
}

/** One file's quoted error lines, as `<file> "<line>" (N tests), ...`, or null when its failures carry none. */
function quotedFile(file: string, failures: readonly SuiteFailure[]): string | null {
  const lines = firstErrorLines(failures.filter((failure) => failure.file === file));
  if (lines.length === 0) return null;
  const quoted = lines.slice(0, ERROR_LINES_QUOTED).map(([line, count]) => `"${line}" (${testCount(count)})`);
  const left = lines.length - quoted.length;
  const more = left > 0
    ? [`and ${left} more lines`]
    : [];
  return `${file} ${[...quoted, ...more].join(', ')}`;
}

/**
 * The first error lines Bun printed for `failures`, by file, `; ` apart,
 * or null when none carries a line. See the module note.
 */
export function quotedErrors(failures: readonly SuiteFailure[]): string | null {
  const files = failingFiles(failures).flatMap(([file]) => {
    const quoted = quotedFile(file, failures);
    return quoted === null
      ? []
      : [quoted];
  });
  if (files.length === 0) return null;
  const left = files.length - ERROR_FILES_QUOTED;
  const more = left > 0
    ? [`and ${left} more files`]
    : [];
  return [...files.slice(0, ERROR_FILES_QUOTED), ...more].join('; ');
}

/** How many errors outside any test {@link unhandledNames} names before it counts the rest. */
const UNHANDLED_NAMED = 10;

/** One error outside any test, as `<file> threw "<first line>"`. */
function unhandledName(error: UnhandledError): string {
  const file = error.file ?? 'a file Bun did not name';
  return error.firstLine === null
    ? `${file} threw an error Bun printed no line for`
    : `${file} threw "${error.firstLine}"`;
}

/**
 * The errors outside any test of a run, each by file and first line,
 * `; ` apart, the first {@link UNHANDLED_NAMED} of them and a count of
 * the rest; a sentence saying none was named when `errors` is empty.
 */
export function unhandledNames(errors: readonly UnhandledError[]): string {
  if (errors.length === 0) return 'no block of Bun\'s stderr named a file';
  const named = errors.slice(0, UNHANDLED_NAMED).map(unhandledName);
  const left = errors.length - named.length;
  const more = left > 0
    ? [`and ${left} more`]
    : [];
  return [...named, ...more].join('; ');
}

/** The files `errors` name, each once, in first-seen order. */
function unhandledFiles(errors: readonly UnhandledError[]): readonly string[] {
  return [...new Set(errors.flatMap((error) => error.file === null
    ? []
    : [error.file]))];
}

/**
 * `path` as a `bun test` argument naming that file alone: `./` before a
 * relative path, an absolute one or one already `./`-led as it is.
 */
export function runnablePath(path: string): string {
  return path.startsWith('/') || path.startsWith('./')
    ? path
    : `./${path}`;
}

/** The blocker's sentences on errors outside any test: their count over the baseline, and each named. */
function errorsText(newErrors: number, errors: readonly UnhandledError[]): string {
  const counted = `${newErrors} more error(s) outside any test than the baseline`;
  if (errors.length === 0) return `${counted}: a test file that throws while it loads, which the JUnit report names no file for.`;
  const files = unhandledFiles(errors);
  const run = files.length === 0
    ? ''
    : ` Run bun test ${files.map(runnablePath).join(' ')} and make each load.`;
  return `${counted}; Bun's stderr named them as ${unhandledNames(errors)}.${run}`;
}

/**
 * The blocker a red step writes: the new failing files with their
 * counts, the command running them and what Bun printed for them, then
 * the errors outside any test by file and first line, or the missing
 * summary, when those made it red. `label` names the step.
 */
export function blockerText(label: string, result: Pick<SuiteResult, 'exitCode' | 'unhandled'>, verdict: StepVerdict): string {
  const files = failingFiles(verdict.fresh);
  const parts = [`The runner's ${label} found failures the suite baseline does not hold.`];
  if (files.length > 0) {
    const named = files.map(([file, count]) => `${file} (${testCount(count)})`);
    parts.push(`New failing test files: ${named.join(', ')}. Run bun test ${files.map(([file]) => runnablePath(file)).join(' ')} and make them pass.`);
    const quoted = quotedErrors(verdict.fresh);
    if (quoted !== null) parts.push(`What Bun printed for them: ${quoted}.`);
  }
  if (verdict.newErrors > 0) parts.push(errorsText(verdict.newErrors, result.unhandled));
  if (verdict.unreported) parts.push(`bun test exited ${result.exitCode} and printed no summary line.`);
  return parts.join(' ');
}

/** The agent a repair task is declared for. */
export const REPAIR_AGENT = 'build-error-resolver';

/** How a repair task's text opens; see the module note. */
const REPAIR_TASK = /^Repair the red (?:task|stage|pre-wrap-up) step at commit \S+$/;

/** How a pre-wrap-up step's repair task's text opens. */
const PRE_WRAP_UP_REPAIR = /^Repair the red pre-wrap-up step at commit \S+$/;

/** How many characters of the commit a repair task's text names. */
const COMMIT_SHOWN = 12;

/** A ticked task line's checkbox. */
const TICKED_PREFIX = '- [x] ';

/** The steps that write a repair task. */
export type RepairStepKind = 'task' | 'stage' | 'pre-wrap-up';

/** Where {@link writeRepairTask} puts a red step's blocker. */
export interface RepairSite {
  readonly kind: RepairStepKind;
  /** HEAD when the step ran, or null when git did not answer. */
  readonly commit: string | null;
  /** The task step's task text, its declaration taken off; absent for a stage step. */
  readonly task?: string;
}

/** What {@link writeRepairTask} wrote. */
export interface RepairWritten {
  /** The repair task's line, counting from zero. */
  readonly line: number;
  /** True when the line was inserted, false when an existing repair was blocked again. */
  readonly inserted: boolean;
}

/** The text of the repair task a red `kind` step at `commit` inserts. */
export function repairTaskText(kind: RepairStepKind, commit: string | null): string {
  const shown = commit === null
    ? '(unread)'
    : commit.slice(0, COMMIT_SHOWN);
  return `Repair the red ${kind} step at commit ${shown}`;
}

/** True when `text`, a task's sentence without its declaration, is a repair task's. */
export function isRepairTask(text: string): boolean {
  return REPAIR_TASK.test(text.trim());
}

/** The line of the last task whose sentence is `text`, or null. */
function lineOfTask(content: string, text: string): number | null {
  const found = parsePlan(content).tasks.filter((task) => task.text === text.trim());
  return found.at(-1)?.lineNum ?? null;
}

/** The line of the last ticked pre-wrap-up repair task, or null. */
function lineOfTickedPreWrapUpRepair(content: string): number | null {
  const found = parsePlan(content).tasks.filter((task) => task.status === 'done' && PRE_WRAP_UP_REPAIR.test(task.text.trim()));
  return found.at(-1)?.lineNum ?? null;
}

/** The existing repair `site` writes its blocker on, or null when it inserts one; see the module note. */
function existingRepairOf(content: string, site: RepairSite): number | null {
  if (site.kind === 'pre-wrap-up') return lineOfTickedPreWrapUpRepair(content);
  return site.task !== undefined && isRepairTask(site.task)
    ? lineOfTask(content, site.task)
    : null;
}

/** Writes `blocker` on the repair task at `line`, opening it first when ticked. */
function blockRepairAgain(trackerPath: string, content: string, line: number, blocker: string): RepairWritten | null {
  const lines = content.split('\n');
  const current = lines[line] ?? '';
  if (current.startsWith(TICKED_PREFIX)) {
    const reopened = [...lines.slice(0, line), `- [ ] ${current.slice(TICKED_PREFIX.length)}`, ...lines.slice(line + 1)];
    writeFileSync(trackerPath, reopened.join('\n'), 'utf8');
  }
  return writeTrackerBlocker(trackerPath, line, blocker)
    ? { line, inserted: false }
    : null;
}

/**
 * Writes `blocker` on a repair task: the repair `site.task` names when
 * the step follows one, or for a pre-wrap-up step the ticked pre-wrap-up
 * repair the tracker holds, else one inserted above the first open plan
 * task. Answers the line written, or null when an existing repair's line
 * would not take it. See the module note.
 */
export function writeRepairTask(trackerPath: string, blocker: string, site: RepairSite): RepairWritten | null {
  const content = readFileSync(trackerPath, 'utf8');
  const repaired = existingRepairOf(content, site);
  if (repaired !== null) return blockRepairAgain(trackerPath, content, repaired, blocker);

  const firstOpen = parsePlan(content).tasks.find((task) => task.status !== 'done')?.lineNum ?? null;
  const entry = { task: repairTaskText(site.kind, site.commit), declaration: `agent=${REPAIR_AGENT}`, blocker };
  return { line: insertTrackerTask(trackerPath, entry, firstOpen), inserted: true };
}
