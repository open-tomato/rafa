/**
 * How long each `tests.alwaysRun` file took in the runner's task step
 * (`runTaskStep`, `suite-step.ts`), and the one line that names the slow
 * ones.
 *
 * ## Why the step times them
 *
 * The always-run files, the content sweeps, run in every `module` and
 * `affected` task step (`task-always-run.ts`), so a sweep's time is paid
 * once per task of every plan. A sweep that grows past
 * {@link SLOW_SWEEP_SECONDS} is named in the run output, so its cost is
 * seen while it is still one file's cost.
 *
 * ## Where the time is read
 *
 * Bun's JUnit report writes one `<testsuite>` per test file directly
 * under `<testsuites>`, with a `file` attribute relative to the directory
 * `bun test` ran in and a `time` attribute in seconds; a nested
 * `<testsuite>` is a `describe` block and is not read. Measured on bun
 * 1.4.2 in a scratch directory: a file sleeping 400 ms at its top level,
 * outside any test, read `time="0.403268888"`, and a file sleeping 400 ms
 * in a `beforeAll` hook read `time="0.403042483"`, so the file's time
 * holds its load and its hooks as well as its tests.
 *
 * The step reads the JUnit file of the run that held the always-run
 * files: the step's own for `module`, which runs them in its path list,
 * and the second run's for `affected`. A `full` step runs no always-run
 * list of its own and is not timed. A JUnit file that is missing or not
 * a whole `<testsuites>` document, an always-run file the report does not
 * name, and a `time` that is not a number each print nothing: the step's
 * own line already says when its JUnit file was not read.
 *
 * ## The line
 *
 * One `info` line names every always-run file over the limit, slowest
 * first, each with its time to one decimal: `🐢 1 tests.alwaysRun
 * file(s) took over 10s in the task step: src/a.sweep.test.ts (12.3s).`
 * A step
 * with none over the limit prints no line. A file at exactly the limit is
 * not over it.
 */
import { existsSync, readFileSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { attributesOf, suitePathArgument } from '../suite/run.js';

/** The time, in seconds, past which an always-run file is named as slow. */
export const SLOW_SWEEP_SECONDS = 10;

/** One test file's time, as the JUnit report names it. */
export interface FileTime {
  /** The file, as the report's `file` attribute names it. */
  readonly file: string;
  readonly seconds: number;
}

/** A `<testsuite>` tag, opening, closing or self-closing. */
const SUITE_TAG = /<(\/?)testsuite\b([^>]*?)(\/?)>/g;

/** The file and time of a top-level suite's attributes, or null when either is absent or not a number. */
function fileTimeOf(attributes: Readonly<Record<string, string>>): FileTime | null {
  const file = attributes['file'] ?? attributes['name'];
  const seconds = Number(attributes['time']);
  if (file === undefined || attributes['time'] === undefined || !Number.isFinite(seconds)) return null;
  return { file, seconds };
}

/**
 * The time of each test file a Bun JUnit report names, read off the
 * `<testsuite>` elements directly under `<testsuites>`, or null when
 * `xml` is not a whole `<testsuites>` document. See the module note.
 */
export function parseJunitFileTimes(xml: string): readonly FileTime[] | null {
  if (!/<testsuites\b/.test(xml) || !xml.includes('</testsuites>')) return null;
  const times: FileTime[] = [];
  let depth = 0;
  for (const [, closing, rest, selfClosing] of xml.matchAll(SUITE_TAG)) {
    if (closing === '/') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const time = depth === 0
      ? fileTimeOf(attributesOf(rest ?? ''))
      : null;
    if (time !== null) times.push(time);
    if (selfClosing !== '/') depth += 1;
  }
  return times;
}

/** The files of `times` that `alwaysRun` names and that took more than `limit` seconds, slowest first. */
export function slowSweeps(times: readonly FileTime[], alwaysRun: readonly string[], limit: number = SLOW_SWEEP_SECONDS): readonly FileTime[] {
  const named = new Set(alwaysRun.map(suitePathArgument));
  const slow = times.filter((time) => named.has(suitePathArgument(time.file)) && time.seconds > limit);
  return [...slow].sort((a, b) => b.seconds - a.seconds);
}

/** The run-output line naming `slow`, or null when it is empty. */
export function slowSweepLine(slow: readonly FileTime[]): string | null {
  if (slow.length === 0) return null;
  const named = slow.map((time) => `${time.file} (${time.seconds.toFixed(1)}s)`).join(', ');
  return `🐢 ${slow.length} tests.alwaysRun file(s) took over ${SLOW_SWEEP_SECONDS}s in the task step: ${named}.`;
}

/** The JUnit file at `path`, its file times read, or none when it is missing or does not read. */
function readFileTimes(path: string): readonly FileTime[] {
  if (!existsSync(path)) return [];
  try {
    return parseJunitFileTimes(readFileSync(path, 'utf8')) ?? [];
  } catch {
    // A file that will not open reads as none: the step's own line names its JUnit reading.
    return [];
  }
}

/**
 * Prints the one line naming each of `alwaysRun` that the JUnit file at
 * `junitFile` times over {@link SLOW_SWEEP_SECONDS}, and answers it; null,
 * printing nothing, when none is over or nothing reads. See the module note.
 */
export function reportSlowSweeps(junitFile: string, alwaysRun: readonly string[]): string | null {
  if (alwaysRun.length === 0) return null;
  const line = slowSweepLine(slowSweeps(readFileTimes(junitFile), alwaysRun));
  if (line !== null) activeOutput().info(line);
  return line;
}
