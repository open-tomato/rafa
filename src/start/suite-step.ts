/**
 * The suite steps the runner (`rafa loop start`) takes around its task
 * sessions: the baseline at the plan's first dispatch, a task step after
 * each task commits, a stage step after each stage's last task, with a
 * catch-up for a stage whose step never ran, and the pre-wrap-up step
 * before the wrap-up session.
 *
 * Each step runs `bun test` itself (`suite/run.ts`: no timeout,
 * `CLAUDECODE` removed, failures read from Bun's JUnit file), appends
 * one {@link SessionStep} to the run record (`loop/sessions.ts`) BEFORE
 * anything acts on it, prints what it found, and answers a
 * {@link StepOutcome}. Deciding whether the run goes on is the caller's:
 * nothing here stops the loop.
 *
 * ## The steps
 *
 * | Step | Runs | Blocks |
 * |---|---|---|
 * | baseline ({@link ensureBaseline}) | the full suite, once per plan | nothing |
 * | task ({@link runTaskStep}) | `taskStepScope` (`suite/scope.ts`) over the task's diff | a repair task it inserts, or the repair it followed |
 * | stage ({@link runStageStep}) | `stageStepScope` over the stage's diff | a repair task it inserts |
 * | pre-wrap-up ({@link runPreWrapUpStep}) | the full suite | a repair task it inserts, or the ticked one it inserted before |
 *
 * **The baseline** is read from `SUITE_BASELINE-<stub>.json` beside the
 * tracker (`suite/baseline.ts`) and reused on a resumed run, which then
 * runs and records nothing. With no file, or one that does not read, the
 * full suite runs at HEAD and is written there. Its failures are the
 * KNOWN ones every later step is split against, and a red baseline
 * blocks nothing: that is what lets a run starting on a red `main` go on.
 *
 * **A task step** runs the scope `taskStepScope` answers from the task
 * line's `tests=` value and the diff from the task's base commit to
 * HEAD: `full` with no paths, `module` over its test files, `affected`
 * as `bun test --changed=<base>`. The plan's `Owns:` folders and the
 * project's test files are read only for a `tests=module` line, the one
 * answer that needs them. A diff git will not answer runs the full
 * suite, the scope that can miss nothing. A `module` or `affected` step
 * also runs the tracked files `tests.alwaysRun` names, the content
 * sweeps no changed file selects (`task-always-run.ts`): `module` in its
 * own path list, and `affected` as a second run, since Bun filters a
 * path list by `--changed`, written to {@link alwaysRunJunitFileFor} and
 * folded into the first run's result before the step is settled. Once
 * settled, a step not read as a stop prints one line naming each of
 * those files its JUnit file times over `SLOW_SWEEP_SECONDS`
 * (`sweep-timing.ts`), and no line when none is.
 *
 * Unless its test run was a stop, a task step then lints the task's diff
 * (`lint-step.ts`: `bunx eslint --no-warn-ignored`, red on a nonzero
 * exit) and, unless the lint was a stop, type-checks the `*.test.ts`
 * files of that diff against the same files at the task's base
 * (`type-step.ts`: red on an error the base did not hold). A red lint or
 * a red type step makes the step red: their texts follow the tests' own
 * in the one blocker, the lint's before the type step's, and either one
 * ended by SIGINT makes the step a stop.
 *
 * **A stage step** runs over the stage's diff: from the commit the last
 * stage step was taken at (the stage ledger, below) or, before any, the
 * baseline's commit, to HEAD. Without `Owns:` folders `stageStepScope`
 * answers `affected`, reason `fallback`, run as `bun test
 * --changed=<since>` from that same commit, with the `tests.alwaysRun`
 * files joined as a task step's `affected` run joins them: a second run,
 * its JUnit file {@link alwaysRunJunitFileFor} of `stage`, folded into
 * the first before the step is settled and recorded as `affected`. With
 * `Owns:` folders it answers the test files under the folders the diff
 * touched plus the integration tier, and no always-run run is added. An
 * empty list runs nothing and records no step, since a step's command
 * is never empty. With neither commit, or a diff git will not answer,
 * the full suite runs.
 *
 * **The recorded reason.** A task or stage step's {@link SessionStep}
 * carries `reason` beside `scope`, so a fallback reads apart from a wide
 * change. A task step records its scope's own reason (`declared`,
 * `trigger`, `fallback` or `no-module-tests`, `suite/scope.ts`), and
 * `declared` for a `module` answer, which only its own `tests=module`
 * line reaches. A stage step records `fallback` for its `--changed` run
 * without `Owns:` folders and `stage` for its `Owns:` path list. A step
 * whose diff git would not answer, or a stage step with no commit to
 * take its diff from, runs the full suite by no scope rule and records
 * no reason; nor do the baseline and the pre-wrap-up step, which always
 * run the full suite.
 *
 * **The pre-wrap-up step** runs the full suite, and stands in for the
 * last stage's stage step, so {@link dueStages} never answers a stage
 * once no task is left open. A red one inserts a repair task after the
 * checklist's last task, or, when the tracker holds a ticked pre-wrap-up
 * repair already, writes its blocker on that line again and inserts
 * nothing ({@link StepOutcome.repairInserted} false), so one repair
 * session is the most it adds. The caller (`suite-steps-run.ts`) turns
 * the loop back to dispatch an inserted repair in the same run, and
 * stops before the wrap-up on a repair blocked again.
 *
 * ## Red, and what a red step writes
 *
 * A step is red when it has a failure the baseline does not hold (a test
 * file and full test name, compared as a pair: `splitFailures`), when it
 * counts more errors outside any test than the baseline counted, or when
 * it exited nonzero with no summary line, so that Bun reported nothing
 * this module could read; a task step is also red on a red lint or a red
 * type step (above).
 * Known failures are printed as known and never make a step red. The
 * error rule compares a scoped run's count against the FULL baseline's,
 * so an inherited load error outside the scope can hide a new one inside
 * it; the pre-wrap-up step, a full run, catches it.
 *
 * A task, stage or pre-wrap-up step whose only red is that excess of
 * errors outside any test (no new failure, a summary read, no red lint
 * and no red type step)
 * is retaken once over the same run ({@link retakeOnErrors}), since such
 * an error can come from a file that throws on one load and not the
 * next. The first run is recorded and printed with the file and first
 * line of each error, then the retake is settled as the step. A retake
 * holding no more errors than the baseline prints one `Intermittent`
 * warning naming the first run's files and lines, and blocks nothing;
 * a retake over the count again is red, and halts the run as any red
 * step does. The retake writes over the first run's JUnit and output
 * files, so those on disk are the settled run's.
 *
 * A task, stage or pre-wrap-up step that reads NEW failures then runs
 * each newly red test file alone, once, before it settles
 * (`retakeRedAlone`, `suite-retake-alone.ts`, whose note is the account
 * of it; `tests.retakeRedAlone: false` turns it off). A file green alone
 * was red only in the step's own file order, by state a file before it
 * left in the shared process: its tests leave the step's new failures,
 * the recorded step lists it under `stepOnly`, and one warning names it.
 * A step whose every new failure is such is green. A file red alone
 * stays a new failure, and the blocker says it was red again alone. So
 * does a file green alone that ran after a test file the step's own
 * diff names (the task's, the stage's, or for the pre-wrap-up step and
 * the task step of a repair task the plan's since the baseline's
 * commit): the change under check may be what left that state, and the
 * blocker names those files. A
 * retake ended by SIGINT makes the step a stop, as below.
 *
 * A red task, stage or pre-wrap-up step inserts a `[BLOCKED]` repair
 * task above the first open plan task, through `insertTrackerTask`
 * (`utils/tracker.ts`), leaving that task as it was: its text names the
 * commit the step ran at, its declaration is
 * `{agent=build-error-resolver}`, and its blocker comment is the step's
 * text. With no open task left, the repair goes after the checklist's
 * last task. A red task step that follows a repair task, and a red
 * pre-wrap-up step finding a ticked pre-wrap-up repair, write the
 * blocker on that repair's line instead, marking it `[BLOCKED]` again,
 * and insert nothing. The text and the writes live in
 * `suite-blocker.ts`. The text names each new failing test file with its
 * count, the command running them (`bun test <files>`), the first error
 * line Bun printed for them, and the errors outside any test, by file
 * and first line, or the missing summary when those made it red; the
 * repair session is handed it through `BLOCKER_PROMPT_PREFIX`
 * (`start/dispatch.ts`). The recorded step keeps those error lines too,
 * up to `MAX_ERROR_LINES` (`suite/failure-lines.ts`) on each of its
 * `newFailures`: Bun's JUnit report names a failing case and not what
 * failed it, so stderr is where they are read.
 *
 * ## SIGINT: a stop, not a red step
 *
 * A step is interrupted when its `bun test` ended on SIGINT, or when the
 * runner received SIGINT while it ran ({@link SuiteStepContext.isInterrupted},
 * read once the run returns). A terminal's Ctrl-C reaches the loop's
 * whole process group, `bun test` included, which ends at once; `rafa
 * loop stop` signals the loop's pid alone, so `bun test` runs to its end
 * and the step is read as interrupted once it returns. A child that
 * `Bun.spawn` sees end on a signal answers 128 plus the signal's number
 * as its exit code (measured on bun 1.4.2: 130 with `signalCode`
 * `SIGINT` for SIGINT, 143 for SIGTERM), so exit code
 * {@link SIGINT_EXIT_CODE} reads as SIGINT; a process exiting 130 on its
 * own says the same by the shell's convention.
 *
 * Such a run answers nothing about the tree: a `bun test` killed midway
 * prints no summary, which would otherwise read as red and insert a
 * repair task. So an interrupted step is recorded with `interrupted: true`
 * (`loop/sessions.ts`) and no new failure, is never red, writes no
 * blocker, and answers {@link StepOutcome.interrupted}, on which the
 * caller ends the run as `rafa loop stop` does. An interrupted baseline
 * is not written and enters no stage in the ledger, and an interrupted
 * stage step is not entered in it, so the next run takes each again.
 *
 * ## The stage ledger
 *
 * The run record is new for every run, so whether a stage's step ran is
 * kept beside the tracker, as the baseline is: `SUITE_STAGES-<stub>.json`
 * ({@link stageLedgerPathFor}), one entry per stage whose step was taken,
 * red or green, with the commit it was taken at. A red step counts as
 * taken: its failures are on its repair task's blocker, and running it
 * again before that repair would only insert a second one.
 *
 * {@link dueStages} answers the stages whose every task is ticked, that
 * hold a task at all, and that the ledger does not name, while an open
 * task is left. The caller asks before each dispatch, so the same call
 * is the step after a stage's last task and the catch-up for a stage
 * whose step an interrupted run never took. A stage is named by its
 * index and heading together, so an edit that moves stages makes their
 * steps due again rather than skipping one. Two stages due at once run
 * in order, the first over both stages' changes and the second over
 * none. When the baseline is first recorded, every stage already
 * complete is entered as covered by it (`via: 'baseline'`), so a plan
 * adopting these steps midway runs no step for its finished stages.
 *
 * A ledger that does not read is warned about and read as empty, which
 * makes a finished stage's step run again: the safe side. Both files are
 * written through a temporary file renamed into place.
 *
 * ## Seams
 *
 * The suite run, the record append, git, the test-file walk, the
 * preload read and the clock arrive through {@link SuiteStepSeams}, and
 * the plan's `Owns:` folders through {@link SuiteStepContext.owns},
 * which {@link planOwnsReader} builds over a `gh` runner, reading them
 * at most once per run. Every line goes through the active output
 * (`adapters/output/active.ts`).
 *
 * ## Where the stage step lives
 *
 * The stage step's code is in `suite-stage-step.ts` and re-exported
 * here; this note stays its account. The helpers it shares with the
 * other steps ({@link seamsOf}, {@link readHead}, {@link readDiff},
 * {@link addToLedger}, {@link runOne}, {@link runWithAlwaysRun},
 * {@link settleStep}, {@link retakeOnErrors}, {@link Settling} and
 * {@link StepRuns}) are exported for it alone.
 *
 * ## Where the task step's diff checks live
 *
 * The checks a task step takes over its diff after its test run, the
 * lint and the type step above, are in `task-step-checks.ts`
 * (`taskDiffChecks`); this note stays their account too.
 * {@link SuiteStepSeams},
 * {@link SuiteStepContext}, {@link TaskStepInput}, {@link Settling},
 * {@link isStepInterrupted} and {@link SIGINT_EXIT_CODE} are what that
 * module imports back from here. `suite-retake-alone.ts` imports back
 * {@link verdictOf}, {@link isCheckInterrupted}, {@link isStepInterrupted}
 * and the two JUnit file paths, exported for it.
 */
import type { LintOutcome, LintRunner } from './lint-step.js';
import type { RepairStepKind, StepVerdict } from './suite-blocker.js';
import type { AloneReading } from './suite-retake-alone.js';
import type { TypeOutcome, TypeRunner } from './type-step.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { TestsSettings } from '../config-schema-tests.js';
import type { SessionStep, SessionStepKind, SessionStepOnly, SessionStepReason } from '../loop/sessions.js';
import type { GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '../suite/run.js';
import type { PreloadReading, TaskStepScope } from '../suite/scope.js';
import type { TestScope } from '../utils/declaration.js';

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { runsDir, updateSession } from '../loop/sessions.js';
import { parsePlan } from '../plan/parse.js';
import { createGitRunner, gitSaid } from '../pr/index.js';
import {
  BASELINE_FILE_PREFIX,
  baselineOf,
  baselinePathFor,
  readBaseline,
  splitFailures,
  writeBaseline,
} from '../suite/baseline.js';
import { readPlanOwns } from '../suite/owns.js';
import { runSuite } from '../suite/run.js';
import {
  listTestFiles,
  readPreloadFiles,
  taskStepScope,
} from '../suite/scope.js';
import { findNextTask } from '../utils/tracker.js';

import { runEslint } from './lint-step.js';
import { blockerText, isRepairTask, unhandledNames, writeRepairTask } from './suite-blocker.js';
import { announceStepOnly, retakeRedAlone, withoutStepOnly } from './suite-retake-alone.js';
import { reportSlowSweeps } from './sweep-timing.js';
import { foldResults, readTaskAlwaysRun, withAlwaysRun } from './task-always-run.js';
import { taskDiffChecks } from './task-step-checks.js';
import { runTsc } from './type-step.js';

export { blockerText } from './suite-blocker.js';
export { runDueStageSteps, runStageStep } from './suite-stage-step.js';
export type { StepVerdict } from './suite-blocker.js';

/** The stage ledger's file name before its stub. */
export const STAGE_LEDGER_PREFIX = 'SUITE_STAGES';

/** The version the ledger is written at, and the only one read. */
export const STAGE_LEDGER_VERSION = 1;

/** The exit code `Bun.spawn` answers for a child ended by SIGINT: 128 plus its number. See the module note. */
export const SIGINT_EXIT_CODE = 128 + constants.signals.SIGINT;

/** How many known failures a step lists by name before it counts the rest. */
const KNOWN_LISTED = 10;

/** The seams a step goes through. Each left out is the system's own. */
export interface SuiteStepSeams {
  /** Runs `bun test`; `runSuite` (`suite/run.ts`) when left out. */
  readonly runSuite?: (options: SuiteRunOptions) => Promise<SuiteResult>;
  /** Appends a step to the run record; `updateSession`'s `appendStep` when left out. */
  readonly appendStep?: (step: SessionStep) => void;
  /** Runs git in the checkout; `createGitRunner(checkout)` when left out. */
  readonly git?: GitRunner;
  /** The project's test files; `listTestFiles` when left out. */
  readonly listTestFiles?: (root: string) => readonly string[];
  /** `bunfig.toml`'s preload files; `readPreloadFiles` when left out. */
  readonly readPreloadFiles?: (root: string) => PreloadReading;
  /** The clock a baseline is dated by. */
  readonly now?: () => Date;
  /** Spawns the task step's ESLint run; `runEslint` (`lint-step.ts`) when left out. */
  readonly runLint?: LintRunner;
  /** Spawns the task step's tsc runs; `runTsc` (`type-step.ts`) when left out. */
  readonly runTypes?: TypeRunner;
}

/** What every step runs against, as `start()` settles it. */
export interface SuiteStepContext {
  /** The project root: the run record and the JUnit files go under its `.rafa/runs/`. */
  readonly repoRoot: string;
  /** The checkout `bun test` and git run in. */
  readonly checkout: string;
  /** The plan's tracker; the baseline and the ledger sit beside it. */
  readonly trackerPath: string;
  /** The run's session id, naming its record. */
  readonly sessionId: string;
  readonly settings: Pick<TestsSettings, 'testsAlwaysRun' | 'testsFullSuiteTriggers' | 'testsIntegration' | 'testsRetakeRedAlone'>;
  /** The plan's `Owns:` folders, or null without any; see {@link planOwnsReader}. */
  readonly owns: () => Promise<readonly string[] | null>;
  /** True once the runner has received SIGINT; never, when left out. See the module note. */
  readonly isInterrupted?: () => boolean;
  readonly seams?: SuiteStepSeams;
}

/** What one step answered. */
export interface StepOutcome {
  readonly kind: SessionStepKind;
  /** The step recorded, or null when nothing ran. */
  readonly step: SessionStep | null;
  /** True when the step found something new; see the module note. */
  readonly red: boolean;
  /** True when the step was read as a stop on SIGINT, never red; see the module note. */
  readonly interrupted: boolean;
  /** The blocker text of a red step, written or not; null when green. */
  readonly blocker: string | null;
  /** The tracker line (from zero) the blocker was written on, or null. */
  readonly blockedLine: number | null;
  /** True when that line is a repair inserted now; false when green, or written on an existing repair. */
  readonly repairInserted: boolean;
}

/** What {@link ensureBaseline} answered. */
export interface BaselineOutcome {
  /** The baseline every later step is split against. */
  readonly baseline: SuiteBaseline;
  /** The step recorded, or null when a stored baseline was reused. */
  readonly step: SessionStep | null;
  /** True when the run was read as a stop on SIGINT: the baseline was not written. */
  readonly interrupted: boolean;
}

/** One stage whose step was taken, or that the baseline covered. */
export interface StageLedgerEntry {
  /** Its index among the plan's stages. */
  readonly stage: number;
  /** Its heading's name. */
  readonly name: string;
  /** The commit the step was taken at, or null when HEAD was not read. */
  readonly commit: string | null;
  /** `step` for a step taken, `baseline` for a stage complete when the baseline was recorded. */
  readonly via: 'step' | 'baseline';
}

/** A stage a step is due for. */
export interface DueStage {
  readonly stage: number;
  readonly name: string;
}

/** What {@link runTaskStep} is handed about the task just committed. */
export interface TaskStepInput {
  readonly baseline: SuiteBaseline | null;
  /** The commit the task started from, which its diff and `--changed` are taken against. */
  readonly base: string;
  /** The task line's `tests=` value, or its default. */
  readonly declared: TestScope;
  /** The task's sentence, for the blocker text. */
  readonly task: string;
}

/** The seams, each filled with the system's own. */
export function seamsOf(context: SuiteStepContext): Required<SuiteStepSeams> {
  const seams = context.seams ?? {};
  return {
    runSuite: seams.runSuite ?? runSuite,
    appendStep: seams.appendStep ?? ((step) => {
      updateSession(context.repoRoot, context.sessionId, { appendStep: step });
    }),
    git: seams.git ?? createGitRunner(context.checkout),
    listTestFiles: seams.listTestFiles ?? listTestFiles,
    readPreloadFiles: seams.readPreloadFiles ?? readPreloadFiles,
    now: seams.now ?? (() => new Date()),
    runLint: seams.runLint ?? runEslint,
    runTypes: seams.runTypes ?? runTsc,
  };
}

/** Where the step of `kind` has Bun write its JUnit file: under the run's own directory. */
export function junitFileFor(repoRoot: string, sessionId: string, kind: SessionStepKind): string {
  return join(runsDir(repoRoot), sessionId, 'suite', `${kind}.junit.xml`);
}

/** Where a task step's, or a stage step's fallback's, second run over the `tests.alwaysRun` files has Bun write its JUnit file. */
export function alwaysRunJunitFileFor(repoRoot: string, sessionId: string, kind: 'task' | 'stage' = 'task'): string {
  return join(runsDir(repoRoot), sessionId, 'suite', `${kind}-always-run.junit.xml`);
}

/** The ledger beside the tracker (or plan) at `trackerPath`; throws as `baselinePathFor` does. */
export function stageLedgerPathFor(trackerPath: string): string {
  const baselinePath = baselinePathFor(trackerPath);
  const name = basename(baselinePath).replace(BASELINE_FILE_PREFIX, STAGE_LEDGER_PREFIX);
  return join(dirname(baselinePath), name);
}

/** True when `value` is a whole ledger entry. */
function isLedgerEntry(value: unknown): value is StageLedgerEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return Number.isInteger(entry['stage'])
    && typeof entry['name'] === 'string'
    && (entry['commit'] === null || typeof entry['commit'] === 'string')
    && (entry['via'] === 'step' || entry['via'] === 'baseline');
}

/** The ledger's entries, or the reason it does not read. */
function parseLedger(text: string): readonly StageLedgerEntry[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'not JSON';
  }
  const record = (typeof parsed === 'object' && parsed !== null
    ? parsed
    : {}) as Record<string, unknown>;
  if (record['version'] !== STAGE_LEDGER_VERSION) return `version ${JSON.stringify(record['version'])}, expected ${STAGE_LEDGER_VERSION}`;
  const stages = record['stages'];
  if (!Array.isArray(stages) || !stages.every(isLedgerEntry)) return 'field stages is missing or malformed';
  return stages;
}

/** The ledger at `path`: none when missing, and none with a warning when it does not read. */
export function readStageLedger(path: string): readonly StageLedgerEntry[] {
  if (!existsSync(path)) return [];
  let parsed: readonly StageLedgerEntry[] | string;
  try {
    parsed = parseLedger(readFileSync(path, 'utf8'));
  } catch (error) {
    parsed = messageOf(error);
  }
  if (typeof parsed !== 'string') return parsed;
  activeOutput().warn(`⚠️  ${basename(path)} does not read (${parsed}); every finished stage's step is taken again.`);
  return [];
}

/** Writes `entries` to the ledger at `path`, whole. */
function writeStageLedger(path: string, entries: readonly StageLedgerEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: STAGE_LEDGER_VERSION, stages: entries }, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

/** Adds `added` to the ledger, each stage not already in it; a failed write is a warning. */
export function addToLedger(trackerPath: string, added: readonly StageLedgerEntry[]): void {
  if (added.length === 0) return;
  const path = stageLedgerPathFor(trackerPath);
  const entries = readStageLedger(path);
  const fresh = added.filter((entry) => !entries.some((held) => sameStage(held, entry)));
  try {
    writeStageLedger(path, [...entries, ...fresh]);
  } catch (error) {
    activeOutput().warn(`⚠️  Could not write ${basename(path)} (${messageOf(error)}); the next run takes these stage steps again.`);
  }
}

/** True when two entries name one stage: index and heading both. */
function sameStage(a: DueStage, b: DueStage): boolean {
  return a.stage === b.stage && a.name === b.name;
}

/** The stages of `trackerContent` holding tasks, every one ticked. */
function completeStages(trackerContent: string): readonly DueStage[] {
  const plan = parsePlan(trackerContent);
  return plan.stages.flatMap((stage, index) => {
    const tasks = plan.tasks.filter((task) => task.stage === index);
    const complete = tasks.length > 0 && tasks.every((task) => task.status === 'done');
    return complete
      ? [{ stage: index, name: stage.name }]
      : [];
  });
}

/**
 * The stages a step is due for, in order: complete, not in `ledger`,
 * while an open task is left. See the module note.
 */
export function dueStages(trackerContent: string, ledger: readonly StageLedgerEntry[]): readonly DueStage[] {
  if (findNextTask(trackerContent) === null) return [];
  return completeStages(trackerContent).filter((stage) => !ledger.some((entry) => sameStage(entry, stage)));
}

/** HEAD in the checkout, or null when git does not answer. */
export function readHead(git: GitRunner): string | null {
  const result = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  const head = result.stdout.trim();
  return result.ok && head !== ''
    ? head
    : null;
}

/** What a task or stage step does when its diff does not read. */
const FULL_SUITE_INSTEAD = 'the step runs the full suite';

/** What the pre-wrap-up step loses when the plan's diff does not read (`suite-retake-alone.ts`). */
const PLAN_DIFF_UNCHECKED = 'no file green alone is checked against the files the plan changed';

/**
 * The paths changed from `from` to HEAD, or null with a warning when
 * git does not answer, which ends in `otherwise`: what the caller does
 * without them.
 */
export function readDiff(git: GitRunner, from: string, otherwise: string = FULL_SUITE_INSTEAD): readonly string[] | null {
  const result = git(['diff', '--name-only', '-z', '--no-renames', from, 'HEAD']);
  if (result.ok) return result.stdout.split('\0').filter((path) => path !== '');
  activeOutput().warn(`⚠️  git diff from ${from} did not answer (${gitSaid(result) || 'nothing said'}); ${otherwise}.`);
  return null;
}

/** A result's failures against `baseline`, and whether they make it red. */
export function verdictOf(result: SuiteResult, baseline: SuiteBaseline | null): StepVerdict {
  const { fresh, known } = splitFailures(result.failures, baseline);
  const newErrors = Math.max(0, (result.errors ?? 0) - (baseline?.errors ?? 0));
  const unreported = result.exitCode !== 0 && result.summary === null && result.noTestFiles !== true;
  return { fresh, known, newErrors, unreported };
}

/** True when `result` ended on SIGINT or the runner received it; see the module note. */
export function isStepInterrupted(context: Pick<SuiteStepContext, 'isInterrupted'>, result: Pick<SuiteResult, 'exitCode'>): boolean {
  return result.exitCode === SIGINT_EXIT_CODE || context.isInterrupted?.() === true;
}

/** True when a verdict blocks. */
function isRed(verdict: StepVerdict): boolean {
  return verdict.fresh.length > 0 || verdict.newErrors > 0 || verdict.unreported;
}

/** A new failure as the run record holds it: its pair, and its error lines when Bun printed any. */
function recordedFailure(failure: SuiteFailure): SuiteFailure {
  return failure.errorLines === undefined
    ? { file: failure.file, name: failure.name }
    : { file: failure.file, name: failure.name, errorLines: failure.errorLines };
}

/**
 * The step the run record holds for `result`, its `reason` right after
 * its scope when it has one and `stepOnly` last when it holds a file;
 * see the module note.
 */
function stepOf(settling: Pick<Settling, 'kind' | 'scope' | 'reason'>, result: SuiteResult, fresh: readonly SuiteFailure[], stepOnly: readonly SessionStepOnly[] = []): SessionStep {
  const { kind, scope, reason } = settling;
  return {
    kind,
    scope,
    ...(reason === undefined
      ? {}
      : { reason }),
    command: [...result.command],
    exitCode: result.exitCode,
    summary: result.summary,
    failures: result.failures.map((failure) => ({ file: failure.file, name: failure.name })),
    newFailures: fresh.map(recordedFailure),
    ...(stepOnly.length === 0
      ? {}
      : { stepOnly }),
  };
}

/** Appends `step` to the run record; a record that cannot be written is a warning. */
function recordStep(seams: Required<SuiteStepSeams>, step: SessionStep): void {
  try {
    seams.appendStep(step);
  } catch (error) {
    activeOutput().warn(`⚠️  Could not record the ${step.kind} step on the run record (${messageOf(error)}); the run goes on.`);
  }
}

/** Prints the step's summary and its known failures. */
function announce(label: string, result: SuiteResult, known: readonly SuiteFailure[]): void {
  activeOutput().info(`🧪 ${label}: ${result.command.join(' ')} exited ${result.exitCode}; ${result.summary ?? 'no summary line'}`);
  if (known.length === 0) return;
  activeOutput().info(`   ${known.length} known failure(s), held by the suite baseline, block nothing:`);
  for (const failure of known.slice(0, KNOWN_LISTED)) activeOutput().info(`   known: ${failure.file} > ${failure.name}`);
  if (known.length > KNOWN_LISTED) activeOutput().info(`   ...and ${known.length - KNOWN_LISTED} more.`);
}

/** What {@link settleStep} is handed about a run already made. */
export interface Settling {
  readonly kind: SessionStepKind;
  readonly scope: SessionStep['scope'];
  /** Why the step ran at `scope`, recorded with it; left out where no scope rule chose it. See the module note. */
  readonly reason?: SessionStepReason;
  readonly label: string;
  readonly result: SuiteResult;
  readonly baseline: SuiteBaseline | null;
  /**
   * What a red step's repair task is for (`suite-blocker.ts`): its kind
   * and, for a task step, the task's sentence; null when it writes none.
   */
  readonly repair: { readonly kind: RepairStepKind; readonly task?: string } | null;
  /** The task step's lint, when it ran; see the module note. */
  readonly lint?: LintOutcome;
  /** The task step's type step, when it ran; see the module note. */
  readonly types?: TypeOutcome;
  /** What the step's newly red files read when run alone, once they were (`suite-retake-alone.ts`). */
  readonly alone?: AloneReading;
}

/** The task step's diff checks `settling` carries, in the order their blockers are written. */
function checksOf(settling: Pick<Settling, 'lint' | 'types'>): readonly (LintOutcome | TypeOutcome)[] {
  return [settling.lint, settling.types].filter((check) => check !== undefined);
}

/** True when one of `settling`'s diff checks was read as a stop on SIGINT. */
export function isCheckInterrupted(settling: Pick<Settling, 'lint' | 'types'>): boolean {
  return checksOf(settling).some((check) => check.interrupted);
}

/** The blockers of `settling`'s red diff checks, the lint's first. */
function checkBlockers(settling: Pick<Settling, 'lint' | 'types'>): readonly string[] {
  return checksOf(settling).flatMap((check) => check.blocker === null
    ? []
    : [check.blocker]);
}

/** Records an interrupted step and says the run stops on it, writing no blocker; see the module note. */
function settleInterrupted(seams: Required<SuiteStepSeams>, settling: Settling): StepOutcome {
  const { kind, label, result } = settling;
  const step: SessionStep = { ...stepOf(settling, result, []), interrupted: true };
  recordStep(seams, step);
  activeOutput().info(`🧪 ${label}: ${result.command.join(' ')} exited ${result.exitCode}; ${result.summary ?? 'no summary line'}`);
  activeOutput().info(`⏹  The ${label} was interrupted by SIGINT: read as a stop, not as failures, so no task is marked blocked.`);
  return { kind, step, red: false, interrupted: true, blocker: null, blockedLine: null, repairInserted: false };
}

/** Records, prints and, when red and `blocks`, writes the blocker; see the module note. */
export function settleStep(context: SuiteStepContext, seams: Required<SuiteStepSeams>, settling: Settling): StepOutcome {
  const { kind, label, result, baseline, alone } = settling;
  if (isStepInterrupted(context, result) || isCheckInterrupted(settling) || alone?.interrupted === true) return settleInterrupted(seams, settling);
  const verdict = withoutStepOnly(verdictOf(result, baseline), alone);
  const step = stepOf(settling, result, verdict.fresh, alone?.stepOnly);
  recordStep(seams, step);
  announce(label, result, verdict.known);
  announceStepOnly(context, settling);
  const checked = checkBlockers(settling);
  if (!isRed(verdict) && checked.length === 0) return { kind, step, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false };

  const tested = isRed(verdict)
    ? [blockerText(label, result, verdict, alone)]
    : [];
  const blocker = [...tested, ...checked].join(' ');
  activeOutput().error(`❌ ${blocker}`);
  const written = settling.repair === null
    ? null
    : writeRepairTask(context.trackerPath, blocker, { ...settling.repair, commit: readHead(seams.git) });
  if (written !== null) activeOutput().error(written.inserted
    ? `   A repair task (line ${written.line + 1}) is inserted, blocked on it.`
    : `   The repair task (line ${written.line + 1}) is marked blocked on it again.`);
  return { kind, step, red: true, interrupted: false, blocker, blockedLine: written?.line ?? null, repairInserted: written?.inserted ?? false };
}

/** True when a step's only red is errors outside any test over the baseline's count. */
function isErrorsOnly(verdict: StepVerdict, settling: Pick<Settling, 'lint' | 'types'>): boolean {
  return verdict.newErrors > 0 && verdict.fresh.length === 0 && !verdict.unreported && checkBlockers(settling).length === 0;
}

/**
 * The run a step settles: `settling`'s own, or, when its only red is
 * errors outside any test, its retake by `rerun`, the first run recorded
 * and printed before it. See the module note.
 */
export async function retakeOnErrors(context: SuiteStepContext, seams: Required<SuiteStepSeams>, settling: Settling, rerun: () => Promise<SuiteResult>): Promise<Settling> {
  const { label, result, baseline } = settling;
  if (isStepInterrupted(context, result) || isCheckInterrupted(settling)) return settling;
  const verdict = verdictOf(result, baseline);
  if (!isErrorsOnly(verdict, settling)) return settling;
  recordStep(seams, stepOf(settling, result, verdict.fresh));
  announce(label, result, verdict.known);
  const named = unhandledNames(result.unhandled);
  activeOutput().warn(`🔁 The ${label} counted ${verdict.newErrors} more error(s) outside any test than the baseline and nothing else red (${named}); taking it once more.`);
  const retake = await rerun();
  const again = verdictOf(retake, baseline);
  if (again.newErrors === 0 && !isStepInterrupted(context, retake)) {
    activeOutput().warn(`⚠️  Intermittent: the retake of the ${label} counted no more errors outside any test than the baseline. The first run's: ${named}. The run goes on.`);
  }
  return { ...settling, result: retake };
}

/** Runs one suite: over `paths`, since `changedSince`, or the whole project; its JUnit file is `kind`'s unless `junitFile` names one. */
export function runOne(context: SuiteStepContext, seams: Required<SuiteStepSeams>, kind: SessionStepKind, narrowing: Pick<SuiteRunOptions, 'paths' | 'changedSince'>, junitFile?: string): Promise<SuiteResult> {
  return seams.runSuite({
    cwd: context.checkout,
    junitFile: junitFile ?? junitFileFor(context.repoRoot, context.sessionId, kind),
    ...narrowing,
  });
}

/**
 * The baseline the run's steps are split against: the stored one, or a
 * full run recorded now, with its step, and the stages already complete
 * entered in the ledger. See the module note.
 */
export async function ensureBaseline(context: SuiteStepContext): Promise<BaselineOutcome> {
  const seams = seamsOf(context);
  const path = baselinePathFor(context.trackerPath);
  const reading = readBaseline(path);
  if (reading.state === 'read') {
    const known = reading.baseline.failures.length;
    activeOutput().info(`📏 Suite baseline reused from ${basename(path)} (${reading.baseline.recordedAt}): ${known} known failure(s).`);
    return { baseline: reading.baseline, step: null, interrupted: false };
  }
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  ${basename(path)} does not read (${reading.reason}); recording the baseline again.`);

  const commit = readHead(seams.git);
  const result = await runOne(context, seams, 'baseline', {});
  const baseline = baselineOf(result, seams.now(), commit);
  const settling: Settling = { kind: 'baseline', scope: 'full', label: 'suite baseline', result, baseline, repair: null };
  if (isStepInterrupted(context, result)) return { baseline, step: settleInterrupted(seams, settling).step, interrupted: true };
  try {
    writeBaseline(path, baseline);
  } catch (error) {
    activeOutput().warn(`⚠️  Could not write ${basename(path)} (${messageOf(error)}); the next run records the baseline again.`);
  }
  const outcome = settleStep(context, seams, settling);
  const covered = completeStages(readFileSync(context.trackerPath, 'utf8'));
  addToLedger(context.trackerPath, covered.map((stage) => ({ ...stage, commit, via: 'baseline' as const })));
  return { baseline, step: outcome.step, interrupted: false };
}

/** The runs a task step or a stage step's fallback makes: its own, and the paths of a second run over the always-run files, or none. */
export interface StepRuns {
  readonly narrowing: Pick<SuiteRunOptions, 'paths' | 'changedSince'>;
  readonly alwaysRun: readonly string[];
  /** The always-run files either run holds, whose times the step reads (`sweep-timing.ts`). */
  readonly timed: readonly string[];
}

/** The runs a task scope asks for, with the `tests.alwaysRun` files `alwaysRun` added; see the module note. */
function taskNarrowing(scope: TaskStepScope, base: string, alwaysRun: readonly string[]): StepRuns {
  if (scope.scope === 'full') return { narrowing: {}, alwaysRun: [], timed: [] };
  if (scope.scope === 'module') return { narrowing: { paths: withAlwaysRun(scope.paths, alwaysRun) }, alwaysRun: [], timed: alwaysRun };
  return { narrowing: { changedSince: base }, alwaysRun, timed: alwaysRun };
}

/**
 * The reason the run record holds for a task scope: the scope's own, or
 * `declared` for a `module` answer, which only a `tests=module` line
 * reaches; none for a diff that did not read. See the module note.
 */
function taskStepReason(scope: TaskStepScope | null): SessionStepReason | undefined {
  if (scope === null) return undefined;
  return scope.scope === 'module'
    ? 'declared'
    : scope.reason;
}

/** The preload files, with a warning when `bunfig.toml` does not read. */
function preloadOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>): readonly string[] {
  const reading = seams.readPreloadFiles(context.checkout);
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  bunfig.toml does not read (${reading.reason}); no preload file is a full-suite trigger.`);
  return reading.files;
}

/** The task step's scope over `diff`, the task's own, or null when that did not read. */
async function taskScopeOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, diff: readonly string[] | null): Promise<TaskStepScope | null> {
  if (diff === null) return null;
  const moduleLine = input.declared === 'module';
  return taskStepScope({
    declared: input.declared,
    diff,
    triggers: { globs: context.settings.testsFullSuiteTriggers, preload: preloadOf(context, seams) },
    owns: moduleLine
      ? await context.owns()
      : null,
    testFiles: moduleLine
      ? seams.listTestFiles(context.checkout)
      : [],
  });
}

/**
 * Reads the plan's diff when asked: from the baseline's commit to HEAD,
 * or `without` when the baseline holds no commit. It is what a
 * pre-wrap-up step, and the task step of a repair task, check their
 * files green alone against (`suite-retake-alone.ts`).
 */
function planDiffReader(seams: Required<SuiteStepSeams>, baseline: SuiteBaseline | null, without: readonly string[] | null): () => readonly string[] | null {
  const commit = baseline?.commit ?? null;
  return () => (commit === null
    ? without
    : readDiff(seams.git, commit, PLAN_DIFF_UNCHECKED));
}

/** Runs the step's own run, then its always-run run unless there is none or the first was a stop, folded into one result. */
export async function runWithAlwaysRun(context: SuiteStepContext, seams: Required<SuiteStepSeams>, kind: 'task' | 'stage', runs: StepRuns): Promise<SuiteResult> {
  const first = await runOne(context, seams, kind, runs.narrowing);
  if (runs.alwaysRun.length === 0 || isStepInterrupted(context, first)) return first;
  const junitFile = alwaysRunJunitFileFor(context.repoRoot, context.sessionId, kind);
  const second = await runOne(context, seams, kind, { paths: runs.alwaysRun }, junitFile);
  return foldResults(first, second, SIGINT_EXIT_CODE);
}

/** Runs the task step after a task commits; see the module note. */
export async function runTaskStep(context: SuiteStepContext, input: TaskStepInput): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const diff = readDiff(seams.git, input.base);
  const scope = await taskScopeOf(context, seams, input, diff);
  const runs = scope === null || scope.scope === 'full'
    ? { narrowing: {}, alwaysRun: [], timed: [] }
    : taskNarrowing(scope, input.base, readTaskAlwaysRun(seams.git, context.settings.testsAlwaysRun));
  const recorded = scope?.scope ?? 'full';
  const result = await runWithAlwaysRun(context, seams, 'task', runs);
  const label = `task step after "${input.task}"`;
  const checks = await taskDiffChecks(context, seams, input, result);
  const settling: Settling = { kind: 'task', scope: recorded, reason: taskStepReason(scope), label, result, baseline: input.baseline, repair: { kind: 'task', task: input.task }, ...checks };
  const retaken = await retakeOnErrors(context, seams, settling, () => runWithAlwaysRun(context, seams, 'task', runs));
  const touched = isRepairTask(input.task)
    ? planDiffReader(seams, input.baseline, diff)
    : () => diff;
  const outcome = settleStep(context, seams, await retakeRedAlone(context, seams, retaken, touched));
  const timedIn = runs.alwaysRun.length > 0
    ? alwaysRunJunitFileFor(context.repoRoot, context.sessionId)
    : junitFileFor(context.repoRoot, context.sessionId, 'task');
  if (!outcome.interrupted) reportSlowSweeps(timedIn, runs.timed);
  return outcome;
}

/** Runs the full suite before the wrap-up; a red one writes its blocker on a pre-wrap-up repair. See the module note. */
export async function runPreWrapUpStep(context: SuiteStepContext, baseline: SuiteBaseline | null): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const result = await runOne(context, seams, 'pre-wrap-up', {});
  const settling: Settling = { kind: 'pre-wrap-up', scope: 'full', label: 'pre-wrap-up step', result, baseline, repair: { kind: 'pre-wrap-up' } };
  const retaken = await retakeOnErrors(context, seams, settling, () => runOne(context, seams, 'pre-wrap-up', {}));
  return settleStep(context, seams, await retakeRedAlone(context, seams, retaken, planDiffReader(seams, baseline, null)));
}

/** What {@link planOwnsReader} reads the folders with. */
export interface PlanOwnsReaderOptions {
  /** The plan's text; its `rafa:plan` header's `issue` starts the chain. */
  readonly planContent: string;
  readonly gh: GhRunner;
}

/**
 * The plan's `Owns:` folders, read through `readPlanOwns`
 * (`suite/owns.ts`) the first time they are asked for and answered from
 * then on, saying once which way stage steps are narrowed.
 */
export function planOwnsReader(options: PlanOwnsReaderOptions): () => Promise<readonly string[] | null> {
  let reading: Promise<readonly string[] | null> | null = null;
  const read = async (): Promise<readonly string[] | null> => {
    const owns = await readPlanOwns({ issue: parsePlan(options.planContent).header.issue, gh: options.gh });
    if (owns.owns === null) {
      activeOutput().info(`🗂  Stage steps fall back to bun test --changed=<since> with the tests.alwaysRun files: ${owns.detail}.`);
      return null;
    }
    activeOutput().info(`🗂  Stage steps run the tests under epic #${owns.epic}'s Owns: folders: ${owns.owns.join(', ')}.`);
    return owns.owns;
  };
  return () => {
    reading ??= read();
    return reading;
  };
}
