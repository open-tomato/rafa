/**
 * What a red suite step writes on the tracker (`suite-step.ts`): the
 * blocker text, and the repair task that carries it.
 *
 * {@link blockerText} names each new failing test file with its count,
 * the command running them (`bun test <files>`), and the errors or the
 * missing summary when those made the step red. Errors outside any test
 * are named by file and first line, as Bun's stderr printed them
 * ({@link unhandledNames}): the JUnit report holds no file for them.
 * The baseline keeps only their count, so every block of the run is
 * named, the inherited ones included.
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

/** The blocker's sentences on errors outside any test: their count over the baseline, and each named. */
function errorsText(newErrors: number, errors: readonly UnhandledError[]): string {
  const counted = `${newErrors} more error(s) outside any test than the baseline`;
  if (errors.length === 0) return `${counted}: a test file that throws while it loads, which the JUnit report names no file for.`;
  const files = unhandledFiles(errors);
  const run = files.length === 0
    ? ''
    : ` Run bun test ${files.join(' ')} and make each load.`;
  return `${counted}; Bun's stderr named them as ${unhandledNames(errors)}.${run}`;
}

/**
 * The blocker a red step writes: the new failing files with their
 * counts and the command running them, then the errors outside any test
 * by file and first line, or the missing summary, when those made it
 * red. `label` names the step.
 */
export function blockerText(label: string, result: Pick<SuiteResult, 'exitCode' | 'unhandled'>, verdict: StepVerdict): string {
  const files = failingFiles(verdict.fresh);
  const parts = [`The runner's ${label} found failures the suite baseline does not hold.`];
  if (files.length > 0) {
    const named = files.map(([file, count]) => `${file} (${count} ${count === 1
      ? 'test'
      : 'tests'})`);
    parts.push(`New failing test files: ${named.join(', ')}. Run bun test ${files.map(([file]) => file).join(' ')} and make them pass.`);
  }
  if (verdict.newErrors > 0) parts.push(errorsText(verdict.newErrors, result.unhandled));
  if (verdict.unreported) parts.push(`bun test exited ${result.exitCode} and printed no summary line.`);
  return parts.join(' ');
}

/** The agent a repair task is declared for. */
export const REPAIR_AGENT = 'build-error-resolver';

/** How a repair task's text opens; see the module note. */
const REPAIR_TASK = /^Repair the red (?:task|stage) step at commit \S+$/;

/** How many characters of the commit a repair task's text names. */
const COMMIT_SHOWN = 12;

/** A ticked task line's checkbox. */
const TICKED_PREFIX = '- [x] ';

/** The steps that write a repair task. */
export type RepairStepKind = 'task' | 'stage';

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
 * the step follows one, else one inserted above the first open plan task.
 * Answers the line written, or null when an existing repair's line would
 * not take it. See the module note.
 */
export function writeRepairTask(trackerPath: string, blocker: string, site: RepairSite): RepairWritten | null {
  const content = readFileSync(trackerPath, 'utf8');
  const repaired = site.task !== undefined && isRepairTask(site.task)
    ? lineOfTask(content, site.task)
    : null;
  if (repaired !== null) return blockRepairAgain(trackerPath, content, repaired, blocker);

  const firstOpen = parsePlan(content).tasks.find((task) => task.status !== 'done')?.lineNum ?? null;
  const entry = { task: repairTaskText(site.kind, site.commit), declaration: `agent=${REPAIR_AGENT}`, blocker };
  return { line: insertTrackerTask(trackerPath, entry, firstOpen), inserted: true };
}
