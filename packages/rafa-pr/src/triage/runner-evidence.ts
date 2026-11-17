/**
 * The runner's own evidence of a red test, as the kind check reads it:
 * the red step captures the runner kept ({@link readKeptCaptures}) and
 * the step repair line the tracker holds for a capture's commit
 * ({@link stepRepairFor}). A session that reports a red test did not run
 * the step that turned it red, but the runner did, and kept what Bun
 * printed under the commit it ran at.
 *
 * ## The kept captures
 *
 * `packages/rafa/src/suite/run.ts` keeps a red run's output text beside
 * its JUnit file as `<name>.<sha>.red.output.txt`, `<sha>` the full
 * `git rev-parse HEAD` of the run's `cwd`, and no later run removes it.
 * A step's JUnit file is `.rafa/runs/<session>/suite/<kind>.junit.xml`,
 * so the captures are read from every `suite/` folder one level under
 * the project's `.rafa/runs/` ({@link runsDir}) of the triage's
 * `repoRoot`. A file is a capture when its name ends in
 * {@link RED_OUTPUT_SUFFIX} and the piece before it, after the last
 * `.`, is a full sha: 40 or 64 lowercase hex digits. `<name>` is the
 * step's file name (`task`, `stage`, `task-alone-1`), answered as
 * `step`.
 *
 * Only a capture taken at the head or at one of the plan's commits is
 * kept (`planFiles.commits`, `./plan-commits.ts`), compared in full and
 * in lower case, so a capture from another plan's run in the same
 * checkout, at a sha this plan never held, is never read as this plan's.
 * Its cases are `failedCaseNamesIn`'s (`../test-failure.ts`): the name
 * of each bun `(fail)` line, describe names first and joined by ` > `,
 * the timing taken off, which is how `testFailureOf` names the case a
 * session quotes ({@link captureHolding}).
 *
 * **An absent reading reads as no capture.** No `.rafa/runs/` folder, a
 * session folder with no `suite/`, a head that is null and commits that
 * are null each answer no capture and no problem: the run kept nothing
 * the check could read, and the table reads as it did before. A folder or
 * a capture that exists and cannot be read is skipped with one problem
 * sentence naming it, and the rest are still read: this module never
 * throws.
 *
 * ## The step repair line
 *
 * A red step inserts a repair task whose sentence is `repairTaskText`'s
 * (`packages/rafa-run/src/start/suite-blocker.ts`): `Repair the red
 * <kind> step at commit <shown>`, `<kind>` one of `task`, `stage` and
 * `pre-wrap-up`, and `<shown>` the first 12 characters of the step's
 * commit. This package does not import `rafa-run`, so the sentence is
 * read here by its own pattern, held to that shape by a fixture in the
 * test file. A line answers a capture's commit when its `<shown>` is at
 * least {@link MIN_SHOWN_COMMIT} hex digits and opens that commit; the
 * `(unread)` a step with no head writes answers none. The line is any
 * task line of the tracker, open, blocked or ticked, its declaration and
 * trailing comments taken off, and of several the last one answers, as
 * the suite step reads its own repairs. The step's kind is not compared
 * with the capture's `step`: both are red at one commit, and the repair
 * line covers that commit's red.
 */
import type { TrackerTask } from '@open-tomato/rafa/utils/tracker';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { runsDir } from '@open-tomato/rafa/core/loop';
import { parseTaskDeclaration } from '@open-tomato/rafa/core/plan';
import { RED_OUTPUT_SUFFIX } from '@open-tomato/rafa/suite/run';
import { failedCaseNamesIn } from '@open-tomato/rafa/triage/test-failure';
import { listTrackerTasks } from '@open-tomato/rafa/utils/tracker';

/** The folder of a session's run folder the suite steps write to. */
export const SUITE_DIR = 'suite';

/** The fewest hex digits of a commit a step repair line must show to answer it. */
export const MIN_SHOWN_COMMIT = 7;

/** A full commit sha: SHA-1's 40 hex digits or SHA-256's 64. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A step repair's sentence: the step's kind and the commit it shows. */
const STEP_REPAIR = /^Repair the red (task|stage|pre-wrap-up) step at commit ([0-9a-f]+)$/;

/** One red step capture the runner kept. */
export interface KeptCapture {
  /** The capture's path. */
  readonly file: string;
  /** The step's file name, the `<name>` of `<name>.<sha>.red.output.txt`. */
  readonly step: string;
  /** The commit the step ran at, in full and in lower case. */
  readonly sha: string;
  /** The case name of each `(fail)` line it holds, in order; see the module note. */
  readonly cases: readonly string[];
}

/** The commits {@link readKeptCaptures} keeps captures for. */
export interface CaptureCommits {
  /** The run checkout's `HEAD`, or null when it was not read. */
  readonly head: string | null;
  /** The plan's commits, as `readPlanFiles` read them, or null when not read. */
  readonly commits: readonly string[] | null;
}

/** What {@link readKeptCaptures} read. */
export interface KeptCaptures {
  /** The captures taken at one of the commits, by session folder then file name. */
  readonly captures: readonly KeptCapture[];
  /** One sentence for each folder or capture that exists and could not be read. */
  readonly problems: readonly string[];
}

/** The step repair line {@link stepRepairFor} found. */
export interface StepRepairLine {
  /** The task's line in the tracker, counting from zero. */
  readonly line: number;
  /** The task's sentence, its declaration and trailing comments taken off. */
  readonly text: string;
  /** The step the repair is for. */
  readonly kind: 'task' | 'stage' | 'pre-wrap-up';
  /** The commit as the line shows it. */
  readonly shown: string;
}

/** The names in folder `dir`, sorted, or a problem sentence; null when it does not exist. */
function namesIn(dir: string, directories: boolean): readonly string[] | string | null {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (directories
        ? entry.isDirectory()
        : entry.isFile()))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return `the folder ${dir} could not be read: ${messageOf(error)}`;
  }
}

/** The step and sha of a capture's file name, or null when `name` is none. */
function captureNameOf(name: string): { readonly step: string; readonly sha: string } | null {
  if (!name.endsWith(RED_OUTPUT_SUFFIX)) return null;
  const rest = name.slice(0, -RED_OUTPUT_SUFFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const sha = rest.slice(dot + 1);
  return FULL_SHA.test(sha)
    ? { step: rest.slice(0, dot), sha }
    : null;
}

/** The shas of `at` in lower case, the head first. */
function wantedShas(at: CaptureCommits): ReadonlySet<string> {
  const all = [...(at.head === null
    ? []
    : [at.head]), ...(at.commits ?? [])];
  return new Set(all.map((sha) => sha.trim().toLowerCase()));
}

/** The captures of one `suite/` folder taken at one of `wanted`, and the problems met. */
function capturesIn(suite: string, wanted: ReadonlySet<string>): KeptCaptures {
  const names = namesIn(suite, false);
  if (names === null) return { captures: [], problems: [] };
  if (typeof names === 'string') return { captures: [], problems: [names] };
  const captures: KeptCapture[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const found = captureNameOf(name);
    if (found === null || !wanted.has(found.sha)) continue;
    const file = join(suite, name);
    try {
      captures.push({ file, ...found, cases: failedCaseNamesIn(readFileSync(file, 'utf8')) });
    } catch (error) {
      problems.push(`the kept capture ${file} could not be read: ${messageOf(error)}`);
    }
  }
  return { captures, problems };
}

/**
 * The red step captures kept under `repoRoot`'s `.rafa/runs/*\/suite/`
 * that were taken at `at.head` or one of `at.commits`, with their cases;
 * see the module note. Never throws.
 */
export function readKeptCaptures(repoRoot: string, at: CaptureCommits): KeptCaptures {
  const wanted = wantedShas(at);
  if (wanted.size === 0) return { captures: [], problems: [] };
  const root = runsDir(repoRoot);
  const sessions = namesIn(root, true);
  if (sessions === null) return { captures: [], problems: [] };
  if (typeof sessions === 'string') return { captures: [], problems: [sessions] };
  const read = sessions.map((session) => capturesIn(join(root, session, SUITE_DIR), wanted));
  return {
    captures: read.flatMap((one) => one.captures),
    problems: read.flatMap((one) => one.problems),
  };
}

/** The first of `captures` holding the case named `name`, or null. */
export function captureHolding(captures: readonly KeptCapture[], name: string): KeptCapture | null {
  return captures.find((capture) => capture.cases.includes(name)) ?? null;
}

/** The step repair `task` is, when its shown commit opens `sha`; else null. */
function stepRepairOf(task: TrackerTask, sha: string): StepRepairLine | null {
  const text = parseTaskDeclaration(task.task).text.trim();
  const found = STEP_REPAIR.exec(text);
  if (found === null) return null;
  const shown = found[2]!;
  if (shown.length < MIN_SHOWN_COMMIT || !sha.startsWith(shown)) return null;
  return { line: task.lineNum, text, kind: found[1] as StepRepairLine['kind'], shown };
}

/**
 * The last step repair line of `trackerContent` whose commit opens
 * `sha`, a capture's commit, or null when it holds none; see the module
 * note.
 */
export function stepRepairFor(trackerContent: string, sha: string): StepRepairLine | null {
  const commit = sha.trim().toLowerCase();
  const found = listTrackerTasks(trackerContent)
    .map((task) => stepRepairOf(task, commit))
    .filter((repair): repair is StepRepairLine => repair !== null);
  return found.at(-1) ?? null;
}
