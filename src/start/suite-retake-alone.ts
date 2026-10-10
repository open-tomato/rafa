/**
 * The retake a task, stage or pre-wrap-up step (`suite-step.ts`) makes of
 * each newly red test file, alone, before it settles: what tells a file
 * red on its own from one red only in the step's file order.
 *
 * ## Why a step reruns a red file alone
 *
 * `bun test` runs the files of one selection in one process, one after
 * another (`suite/run.ts`, "The order the files ran in"), so a
 * module-level value one test file leaves behind is read by every file
 * after it. A file failed that way is green from a shell and green in
 * the repair session that is handed it, which reruns it, changes nothing
 * and reports done, and the next step over the same selection is red
 * again. Issue 926 measured it: `src/utils/claude.test.ts` read 21 cases
 * red in the runner's task and stage steps only, each throwing
 * `UndeclaredSpendError` from a record another file had left, and one
 * run of 2026-10-10 inserted five repair tasks for it, about 32 minutes
 * of sessions that changed no file.
 *
 * ## The retake
 *
 * {@link retakeRedAlone} is called between the step's run and its
 * settling, after the retake on errors outside any test. It does nothing
 * when `tests.retakeRedAlone` is false, when the step was read as a stop
 * on SIGINT, or when the step holds no NEW failure: a failure the
 * baseline holds is never retaken. Else it takes the files of the new
 * failures in first-seen order, the first {@link RETAKE_ALONE_MAX_FILES}
 * of them, and runs each as `bun test ./<file>`, one process per file,
 * through the same `runSuite` seam the step ran through, so with the
 * same directory, environment and reporter. Its JUnit file is
 * {@link aloneJunitFileFor}, `<kind>-alone-<n>.junit.xml` beside the
 * step's own, which it leaves as they were. Each retake reads as one of
 * three:
 *
 *   - **green alone**: a summary line, a JUnit file that read, no error
 *     outside any test, and no failure the baseline does not hold. The
 *     file was red only in the step ({@link AloneReading.stepOnly}). A
 *     file holding an inherited failure beside its new ones is green
 *     alone when only the inherited one is left.
 *   - **red alone**: a summary line and a JUnit file that read, with a
 *     failure the baseline does not hold or an error outside any test
 *     ({@link AloneReading.redAlone}).
 *   - **not read**: no summary line, no JUnit file, or a run that could
 *     not be spawned, which is warned about. The file stays a new
 *     failure, as does every file past the cap, with nothing said of how
 *     it ran alone.
 *
 * A retake ended by SIGINT, or returning after the runner received it,
 * ends the retakes and makes the step a stop
 * ({@link AloneReading.interrupted}), as the step's own run would.
 *
 * ## What the step does with the reading
 *
 * `settleStep` takes the tests of every file green alone out of the
 * step's new failures ({@link withoutStepOnly}), so a step whose every
 * new failure was red only in the step is green: no blocker, no repair
 * task, no halt. The recorded step keeps them in `failures` and lists
 * each such file under `stepOnly` (`loop/sessions.ts`) with the names of
 * its tests, the error lines of the first, its place in the order its
 * process ran the files, and the {@link STEP_ONLY_BEFORE} files run just
 * before it, which is where the state it met came from. One warning per
 * file says the same ({@link announceStepOnly}), with the step's output
 * file. When other files stay red, the blocker (`suite-blocker.ts`)
 * names those as red again when run alone, and lists the files green
 * alone apart as not the repair's to fix.
 *
 * ## The cycle with `suite-step.ts`
 *
 * This module imports values back from `suite-step.ts`, which imports
 * it, as `suite-stage-step.ts` does: neither reads the other's bindings
 * at load, only inside its functions.
 */
import type { StepVerdict } from './suite-blocker.js';
import type { Settling, SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { SessionStepKind, SessionStepOnly } from '../loop/sessions.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteFailure, SuiteResult } from '../suite/run.js';

import { join, relative } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { runsDir } from '../loop/sessions.js';
import { splitFailures } from '../suite/baseline.js';
import { failingFilesOf } from '../suite/failure-lines.js';
import { outputFileFor } from '../suite/run.js';

import { alwaysRunJunitFileFor, isCheckInterrupted, isStepInterrupted, junitFileFor, verdictOf } from './suite-step.js';

/** The most newly red files a step runs alone; the rest stay new failures. */
export const RETAKE_ALONE_MAX_FILES = 20;

/** The most files run just before a file that its `stepOnly` entry names. */
export const STEP_ONLY_BEFORE = 5;

/** What the retakes of one step read. See the module note. */
export interface AloneReading {
  /** The files green alone, in the order retaken. */
  readonly stepOnly: readonly SessionStepOnly[];
  /** The files red again alone, in the order retaken. */
  readonly redAlone: readonly string[];
  /** True when a retake was read as a stop on SIGINT. */
  readonly interrupted: boolean;
}

/** Where the `nth` retake of a `kind` step, counted from 1, has Bun write its JUnit file. */
export function aloneJunitFileFor(repoRoot: string, sessionId: string, kind: SessionStepKind, nth: number): string {
  return join(runsDir(repoRoot), sessionId, 'suite', `${kind}-alone-${nth}.junit.xml`);
}

/** How one retake read: see the module note. */
type AloneVerdict = 'green' | 'red' | 'unread';

/** Where a file ran: which of the step's processes, its place there from 1, and the files just before it. */
interface FilePlace {
  /** The process's index in `SuiteResult.fileOrder`: 0 the step's own run, 1 its always-run run. */
  readonly run: number;
  readonly position: number;
  readonly before: readonly string[];
}

/** The place of `file` in the first of `orders` that holds it, or null when none does. */
function placeOf(file: string, orders: readonly (readonly string[])[]): FilePlace | null {
  for (const [run, order] of orders.entries()) {
    const at = order.indexOf(file);
    if (at >= 0) return { run, position: at + 1, before: order.slice(Math.max(0, at - STEP_ONLY_BEFORE), at) };
  }
  return null;
}

/** The `stepOnly` entry of `file`, whose new failures in the step were `fresh`. */
function stepOnlyOf(file: string, fresh: readonly SuiteFailure[], result: SuiteResult): SessionStepOnly {
  const own = fresh.filter((failure) => failure.file === file);
  const place = placeOf(file, result.fileOrder ?? []);
  return {
    file,
    tests: own.map((failure) => failure.name),
    errorLines: own.find((failure) => failure.errorLines !== undefined)?.errorLines ?? [],
    position: place?.position ?? null,
    before: place?.before ?? [],
  };
}

/** How `retake`, one file's run alone, read against `baseline`; null is a run that could not be spawned. */
function aloneVerdict(retake: SuiteResult | null, baseline: SuiteBaseline | null): AloneVerdict {
  if (retake === null || retake.summary === null || retake.junit !== 'read') return 'unread';
  const fresh = splitFailures(retake.failures, baseline).fresh;
  return fresh.length === 0 && (retake.errors ?? 0) === 0
    ? 'green'
    : 'red';
}

/** Runs `file` alone as the `nth` retake of the step, or answers null with a warning when the run throws. */
async function runAlone(context: SuiteStepContext, seams: Required<SuiteStepSeams>, kind: SessionStepKind, file: string, nth: number): Promise<SuiteResult | null> {
  try {
    return await seams.runSuite({
      cwd: context.checkout,
      paths: [file],
      junitFile: aloneJunitFileFor(context.repoRoot, context.sessionId, kind, nth),
    });
  } catch (error) {
    activeOutput().warn(`⚠️  Could not run ${file} alone (${messageOf(error)}); it stays a new failure.`);
    return null;
  }
}

/** `reading` with `file` entered as its retake read: green alone, red alone, or left out when not read. */
function entered(reading: AloneReading, how: AloneVerdict, file: string, fresh: readonly SuiteFailure[], result: SuiteResult): AloneReading {
  if (how === 'green') return { ...reading, stepOnly: [...reading.stepOnly, stepOnlyOf(file, fresh, result)] };
  return how === 'red'
    ? { ...reading, redAlone: [...reading.redAlone, file] }
    : reading;
}

/** Says what the retakes of `taken` files read, and how many files past the cap were left as they were. */
function announceRetakes(reading: AloneReading, taken: number, left: number): void {
  const unread = taken - reading.stepOnly.length - reading.redAlone.length;
  activeOutput().info(`   Run alone: ${reading.stepOnly.length} green (red only in the step), ${reading.redAlone.length} red again, ${unread} not read.`);
  if (left > 0) activeOutput().info(`   ${left} more newly red file(s) were not run alone (the cap is ${RETAKE_ALONE_MAX_FILES}); they stay new failures.`);
}

/** `settling` with what its newly red files read when run alone; see the module note. */
export async function retakeRedAlone(context: SuiteStepContext, seams: Required<SuiteStepSeams>, settling: Settling): Promise<Settling> {
  const { kind, label, result, baseline } = settling;
  if (!context.settings.testsRetakeRedAlone) return settling;
  if (isStepInterrupted(context, result) || isCheckInterrupted(settling)) return settling;
  const { fresh } = verdictOf(result, baseline);
  const files = failingFilesOf(fresh);
  if (files.length === 0) return settling;

  const taken = files.slice(0, RETAKE_ALONE_MAX_FILES);
  activeOutput().info(`🔁 The ${label} read new failures in ${files.length} test file(s); running ${taken.length} alone, once each, to tell a file red on its own from one red only in the step's file order.`);
  let reading: AloneReading = { stepOnly: [], redAlone: [], interrupted: false };
  for (const [index, file] of taken.entries()) {
    const retake = await runAlone(context, seams, kind, file, index + 1);
    if (isStepInterrupted(context, retake ?? { exitCode: 0 })) return { ...settling, alone: { ...reading, interrupted: true } };
    reading = entered(reading, aloneVerdict(retake, baseline), file, fresh, result);
  }
  announceRetakes(reading, taken.length, files.length - taken.length);
  return { ...settling, alone: reading };
}

/** `verdict` without the new failures of the files `alone` read green alone. */
export function withoutStepOnly(verdict: StepVerdict, alone: AloneReading | undefined): StepVerdict {
  if (alone === undefined || alone.stepOnly.length === 0) return verdict;
  const green = new Set(alone.stepOnly.map((entry) => entry.file));
  return { ...verdict, fresh: verdict.fresh.filter((failure) => !green.has(failure.file)) };
}

/** Where `entry` ran, as the warning says it. */
function placeText(entry: SessionStepOnly): string {
  if (entry.position === null) return 'its place in the step\'s file order was not read';
  return entry.before.length === 0
    ? 'the first file of its run'
    : `file ${entry.position} of its run, after ${entry.before.join(', ')}`;
}

/** The output file of the process `file` ran in, relative to the project root: the step's own, or its always-run run's. */
function captureOf(context: SuiteStepContext, settling: Pick<Settling, 'kind' | 'result'>, file: string): string {
  const run = placeOf(file, settling.result.fileOrder ?? [])?.run ?? 0;
  const junitFile = run > 0 && (settling.kind === 'task' || settling.kind === 'stage')
    ? alwaysRunJunitFileFor(context.repoRoot, context.sessionId, settling.kind)
    : junitFileFor(context.repoRoot, context.sessionId, settling.kind);
  return relative(context.repoRoot, outputFileFor(junitFile));
}

/** Prints one warning for each file of `settling` that was red only in the step. */
export function announceStepOnly(context: SuiteStepContext, settling: Settling): void {
  for (const entry of settling.alone?.stepOnly ?? []) {
    const [first] = entry.errorLines;
    const error = first === undefined
      ? 'Bun printed no error line for it.'
      : `First error: "${first}".`;
    const count = `${entry.tests.length} ${entry.tests.length === 1
      ? 'test'
      : 'tests'}`;
    activeOutput().warn(`⚠️  Red only in the step: ${entry.file} read ${count} failing in the ${settling.label} and was green when run alone: ${placeText(entry)}. ${error} Capture: ${captureOf(context, settling, entry.file)}. It blocks nothing and gets no repair task.`);
  }
}
