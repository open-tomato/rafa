/**
 * The test files a run's suite steps read red only in the step, made
 * durable: gathered off the run's record, listed in the wrap-up
 * session's prompt for the pull request body, and printed once at the
 * run's end.
 *
 * ## Why the list exists
 *
 * A step that reruns a newly red file alone and finds it green takes it
 * out of its new failures (`start/suite-retake-alone.ts`): it blocks
 * nothing and gets no repair task. That is right for the run, and it
 * leaves the file failing in every step from then on, said once in a
 * warning that scrolls away and kept under `stepOnly` on a record
 * nobody opens. The state that failed it is still in the tree. So the
 * list is carried to the two places a person reads after a run: the
 * pull request, and the run's last lines.
 *
 * ## The list
 *
 * {@link runStepOnlyOf} reads the recorded steps (`loop/sessions.ts`)
 * in order and answers one {@link RunStepOnly} per file, in the order
 * first met. A file several steps read so is listed once: it keeps the
 * tests, the first error line, the place and the files before it of the
 * first step that read it, and names every such step by kind, one per
 * step, so the same kind can repeat. A step that took its run twice
 * (the retake on errors outside any test, `suite-step.ts`) is recorded
 * twice and counts as two.
 *
 * {@link readRunStepOnly} reads them off the record of one run. A
 * record that is not there or does not read answers none and says
 * nothing: the run's own writes to that record (`start/session.ts`)
 * warn about it, at the wrap-up's start and at the run's end, which are
 * the two places this is read. Only this run's record is read, so a
 * plan worked over several runs lists in each pull request body the
 * files of the run that opened it.
 *
 * ## Where it goes
 *
 * {@link stepOnlyLines} writes one line per file, the same for both
 * places: its tests by count and the first {@link STEP_ONLY_TESTS_NAMED}
 * names, how many steps read it so and their kinds, the first error
 * line Bun printed, and the files run just before it, which is where
 * the state it met came from.
 *
 *   - {@link stepOnlySection} is the wrap-up prompt's section
 *     (`start/wrap-up.ts`, and the retry's through it): a heading, what
 *     the session is asked for, and the lines. The session is asked to
 *     put the list in the pull request body under
 *     `### {@link STEP_ONLY_HEADING}` and to change no code for it. With
 *     no file the section is not written at all, not even its heading.
 *   - {@link announceRunStepOnly} prints the list at the run's end
 *     (`start.ts`, in the `finally` every way out passes), as warnings
 *     through the active output (`adapters/output/active.ts`), and
 *     prints nothing with no file.
 *
 * A pull request the runner opens itself (`start/runner-pr.ts`), after
 * every retry session ended without one, carries the release fragment's
 * notes and not this list; the run's end still prints it.
 */
import type { SessionStep, SessionStepKind, SessionStepOnly } from '../loop/sessions.js';

import { activeOutput } from '../adapters/output/active.js';
import { readSession, sessionSteps } from '../loop/sessions.js';

/** The heading the list goes under, in the prompt and in the pull request body. */
export const STEP_ONLY_HEADING = 'Test files red only in a suite step';

/** The most test names one line gives before it counts the rest. */
export const STEP_ONLY_TESTS_NAMED = 3;

/** One test file a run's steps read red only in the step. See the module note. */
export interface RunStepOnly {
  /** The test file, relative to the checkout. */
  readonly file: string;
  /** The kinds of the steps that read it so, in the order recorded, one per step. */
  readonly steps: readonly SessionStepKind[];
  /** The full names of its tests red in the first of those steps. */
  readonly tests: readonly string[];
  /** The first error line Bun printed for them there, or null when it printed none. */
  readonly firstError: string | null;
  /** Its place there, from 1, in the order its process ran the files; null when that order did not hold it. */
  readonly position: number | null;
  /** The files run just before it there, in run order. */
  readonly before: readonly string[];
}

/** `items` with `entry`, what a step of `kind` holds for one file, entered: a new item, or one more step on the item held. */
function entered(items: readonly RunStepOnly[], kind: SessionStepKind, entry: SessionStepOnly): readonly RunStepOnly[] {
  if (items.some((item) => item.file === entry.file)) {
    return items.map((item) => (item.file === entry.file
      ? { ...item, steps: [...item.steps, kind] }
      : item));
  }
  return [...items, {
    file: entry.file,
    steps: [kind],
    tests: entry.tests,
    firstError: entry.errorLines[0] ?? null,
    position: entry.position,
    before: entry.before,
  }];
}

/** The files `steps` read red only in the step, one item per file in the order first met. See the module note. */
export function runStepOnlyOf(steps: readonly SessionStep[]): readonly RunStepOnly[] {
  return steps.reduce<readonly RunStepOnly[]>(
    (items, step) => (step.stepOnly ?? []).reduce((held, entry) => entered(held, step.kind, entry), items),
    [],
  );
}

/**
 * The files the steps of run `sessionId` read red only in the step, off
 * its record under `repoRoot`; none, with nothing said, when the record
 * is not there or does not read. See the module note.
 */
export function readRunStepOnly(repoRoot: string, sessionId: string): readonly RunStepOnly[] {
  try {
    return runStepOnlyOf(sessionSteps(readSession(repoRoot, sessionId)));
  } catch {
    return [];
  }
}

/** `count` things, as `1 <thing>` or `N <thing>s`. */
function counted(count: number, thing: string): string {
  return `${count} ${count === 1
    ? thing
    : `${thing}s`}`;
}

/** The tests of `item`, as `2 tests (\`a\`, \`b\`)`, the first {@link STEP_ONLY_TESTS_NAMED} named. */
function testsText(item: RunStepOnly): string {
  const named = item.tests.slice(0, STEP_ONLY_TESTS_NAMED).map((name) => `\`${name}\``);
  const left = item.tests.length - named.length;
  const more = left > 0
    ? ` and ${left} more`
    : '';
  return `${counted(item.tests.length, 'test')} (${named.join(', ')}${more})`;
}

/** Where `item` ran: the files before it, that it ran first, or that its place was not read. */
function placeText(item: RunStepOnly): string {
  if (item.before.length > 0) return `run after ${item.before.join(', ')}`;
  return item.position === null
    ? 'its place in the step\'s file order was not read'
    : 'the first file of its run';
}

/** One line of the list. See the module note. */
function stepOnlyLine(item: RunStepOnly): string {
  const kinds = [...new Set(item.steps)].join(', ');
  const error = item.firstError === null
    ? 'Bun printed no error line for it'
    : `first error: "${item.firstError}"`;
  return `- \`${item.file}\`: ${testsText(item)} red in ${counted(item.steps.length, 'step')} (${kinds}) and green when run alone; ${error}; ${placeText(item)}.`;
}

/** The list, one line per file. See the module note. */
export function stepOnlyLines(items: readonly RunStepOnly[]): readonly string[] {
  return items.map(stepOnlyLine);
}

/**
 * The wrap-up prompt's section over `items`, opening with a blank line,
 * or nothing at all when there is none. See the module note.
 */
export function stepOnlySection(items: readonly RunStepOnly[]): readonly string[] {
  if (items.length === 0) return [];
  return [
    '',
    `## ${STEP_ONLY_HEADING}`,
    '',
    `The runner read each test file below red in one of its suite steps and green when it ran that file alone, so none of them blocked the run and none got a repair task. A test file run before it left the state that failed it, and nothing in this run fixed that. Put the list in the pull request body under the heading \`### ${STEP_ONLY_HEADING}\`, each line as it is written here, so a reviewer sees it. Change no code for these files in this session.`,
    '',
    ...stepOnlyLines(items),
  ];
}

/** Prints the list at the run's end, as warnings; nothing when there is none. See the module note. */
export function announceRunStepOnly(items: readonly RunStepOnly[]): void {
  if (items.length === 0) return;
  activeOutput().warn(`\n⚠️  ${items.length} test file(s) read red only in a suite step of this run, green when run alone. Nothing blocked on them and nothing fixed them:`);
  for (const line of stepOnlyLines(items)) activeOutput().warn(`   ${line}`);
}
