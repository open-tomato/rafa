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
 * | task ({@link runTaskStep}) | `taskStepScope` (`suite/scope.ts`) over the task's diff | the next open task |
 * | stage ({@link runStageStep}) | `stageStepScope` over the stage's diff | the next open task |
 * | pre-wrap-up ({@link runPreWrapUpStep}) | the full suite | nothing: there is no task left |
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
 * suite, the scope that can miss nothing.
 *
 * **A stage step** runs over the stage's diff: from the commit the last
 * stage step was taken at (the stage ledger, below) or, before any, the
 * baseline's commit, to HEAD. `stageStepScope` answers `full` without
 * `Owns:` folders, and otherwise the test files under the folders the
 * diff touched plus the integration tier. An empty list runs nothing and
 * records no step, since a step's command is never empty. With neither
 * commit, or a diff git will not answer, the full suite runs.
 *
 * **The pre-wrap-up step** runs the full suite, and stands in for the
 * last stage's stage step, so {@link dueStages} never answers a stage
 * once no task is left open. A red one writes no blocker, having no
 * task to write it on; the caller stops before the wrap-up, and a rerun
 * takes the step again, since the tracker still has no open task.
 *
 * ## Red, and what a red step writes
 *
 * A step is red when it has a failure the baseline does not hold (a test
 * file and full test name, compared as a pair: `splitFailures`), when it
 * counts more errors outside any test than the baseline counted, or when
 * it exited nonzero with no summary line, so that Bun reported nothing
 * this module could read. Known failures are printed as known and never
 * make a step red. The error rule compares a scoped run's count against
 * the FULL baseline's, so an inherited load error outside the scope can
 * hide a new one inside it; the pre-wrap-up step, a full run, catches it.
 *
 * A red task or stage step writes a blocker on the next open task, the
 * line `findNextTask` answers after the commit (`utils/tracker.ts`),
 * through `writeTrackerBlocker`, which marks it `[BLOCKED]`. The text
 * names each new failing test file with its count, the command running
 * them (`bun test <files>`), and the errors or missing summary when
 * those made it red; the retry session is handed it through
 * `BLOCKER_PROMPT_PREFIX` (`start/dispatch.ts`). A red step with no open
 * task left writes nothing and answers the text all the same.
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
 * prints no summary, which would otherwise read as red and block the
 * next task. So an interrupted step is recorded with `interrupted: true`
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
 * taken: its failures are on the next task's blocker, and running it
 * again before that task's retry would only block the retry again.
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
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { TestsSettings } from '../config-schema-tests.js';
import type { SessionStep, SessionStepKind } from '../loop/sessions.js';
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
  stageStepScope,
  taskStepScope,
} from '../suite/scope.js';
import { findNextTask, writeTrackerBlocker } from '../utils/tracker.js';

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
  readonly settings: Pick<TestsSettings, 'testsFullSuiteTriggers' | 'testsIntegration'>;
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

/** A step's failures split against the baseline, and what else can make it red. */
export interface StepVerdict {
  readonly fresh: readonly SuiteFailure[];
  readonly known: readonly SuiteFailure[];
  readonly newErrors: number;
  /** True when Bun exited nonzero and printed no summary. */
  readonly unreported: boolean;
}

/** The seams, each filled with the system's own. */
function seamsOf(context: SuiteStepContext): Required<SuiteStepSeams> {
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
  };
}

/** Where the step of `kind` has Bun write its JUnit file: under the run's own directory. */
export function junitFileFor(repoRoot: string, sessionId: string, kind: SessionStepKind): string {
  return join(runsDir(repoRoot), sessionId, 'suite', `${kind}.junit.xml`);
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
function addToLedger(trackerPath: string, added: readonly StageLedgerEntry[]): void {
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
function readHead(git: GitRunner): string | null {
  const result = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  const head = result.stdout.trim();
  return result.ok && head !== ''
    ? head
    : null;
}

/** The paths changed from `from` to HEAD, or null with a warning when git does not answer. */
function readDiff(git: GitRunner, from: string): readonly string[] | null {
  const result = git(['diff', '--name-only', '-z', '--no-renames', from, 'HEAD']);
  if (result.ok) return result.stdout.split('\0').filter((path) => path !== '');
  activeOutput().warn(`⚠️  git diff from ${from} did not answer (${gitSaid(result) || 'nothing said'}); the step runs the full suite.`);
  return null;
}

/** A result's failures against `baseline`, and whether they make it red. */
function verdictOf(result: SuiteResult, baseline: SuiteBaseline | null): StepVerdict {
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

/** Each file among `failures` and how many of its tests failed, in first-seen order. */
function failingFiles(failures: readonly SuiteFailure[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const failure of failures) counts.set(failure.file, (counts.get(failure.file) ?? 0) + 1);
  return [...counts.entries()];
}

/**
 * The blocker a red step writes: the new failing files with their
 * counts and the command running them, then the errors or the missing
 * summary when those made it red. `label` names the step.
 */
export function blockerText(label: string, result: Pick<SuiteResult, 'exitCode'>, verdict: StepVerdict): string {
  const files = failingFiles(verdict.fresh);
  const parts = [`The runner's ${label} found failures the suite baseline does not hold.`];
  if (files.length > 0) {
    const named = files.map(([file, count]) => `${file} (${count} ${count === 1
      ? 'test'
      : 'tests'})`);
    parts.push(`New failing test files: ${named.join(', ')}. Run bun test ${files.map(([file]) => file).join(' ')} and make them pass.`);
  }
  if (verdict.newErrors > 0) {
    parts.push(`${verdict.newErrors} more error(s) outside any test than the baseline: a test file that throws while it loads, which the JUnit report names no file for.`);
  }
  if (verdict.unreported) parts.push(`bun test exited ${result.exitCode} and printed no summary line.`);
  return parts.join(' ');
}

/** The step the run record holds for `result`. */
function stepOf(kind: SessionStepKind, scope: SessionStep['scope'], result: SuiteResult, fresh: readonly SuiteFailure[]): SessionStep {
  return {
    kind,
    scope,
    command: [...result.command],
    exitCode: result.exitCode,
    summary: result.summary,
    failures: result.failures.map((failure) => ({ file: failure.file, name: failure.name })),
    newFailures: fresh.map((failure) => ({ file: failure.file, name: failure.name })),
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

/** Writes `text` on the next open task, answering its line, or null when none is left. */
function blockNextOpenTask(trackerPath: string, text: string): number | null {
  const next = findNextTask(readFileSync(trackerPath, 'utf8'));
  if (next === null) return null;
  return writeTrackerBlocker(trackerPath, next.lineNum, text)
    ? next.lineNum
    : null;
}

/** What {@link settleStep} is handed about a run already made. */
interface Settling {
  readonly kind: SessionStepKind;
  readonly scope: SessionStep['scope'];
  readonly label: string;
  readonly result: SuiteResult;
  readonly baseline: SuiteBaseline | null;
  /** Whether a red step writes its blocker on the next open task. */
  readonly blocks: boolean;
}

/** Records an interrupted step and says the run stops on it, writing no blocker; see the module note. */
function settleInterrupted(seams: Required<SuiteStepSeams>, settling: Settling): StepOutcome {
  const { kind, label, result } = settling;
  const step: SessionStep = { ...stepOf(kind, settling.scope, result, []), interrupted: true };
  recordStep(seams, step);
  activeOutput().info(`🧪 ${label}: ${result.command.join(' ')} exited ${result.exitCode}; ${result.summary ?? 'no summary line'}`);
  activeOutput().info(`⏹  The ${label} was interrupted by SIGINT: read as a stop, not as failures, so no task is marked blocked.`);
  return { kind, step, red: false, interrupted: true, blocker: null, blockedLine: null };
}

/** Records, prints and, when red and `blocks`, writes the blocker; see the module note. */
function settleStep(context: SuiteStepContext, seams: Required<SuiteStepSeams>, settling: Settling): StepOutcome {
  const { kind, label, result, baseline } = settling;
  if (isStepInterrupted(context, result)) return settleInterrupted(seams, settling);
  const verdict = verdictOf(result, baseline);
  const step = stepOf(kind, settling.scope, result, verdict.fresh);
  recordStep(seams, step);
  announce(label, result, verdict.known);
  if (!isRed(verdict)) return { kind, step, red: false, interrupted: false, blocker: null, blockedLine: null };

  const blocker = blockerText(label, result, verdict);
  activeOutput().error(`❌ ${blocker}`);
  const blockedLine = settling.blocks
    ? blockNextOpenTask(context.trackerPath, blocker)
    : null;
  if (blockedLine !== null) activeOutput().error(`   The next task (line ${blockedLine + 1}) is marked blocked on it.`);
  return { kind, step, red: true, interrupted: false, blocker, blockedLine };
}

/** Runs one suite: over `paths`, since `changedSince`, or the whole project. */
function runOne(context: SuiteStepContext, seams: Required<SuiteStepSeams>, kind: SessionStepKind, narrowing: Pick<SuiteRunOptions, 'paths' | 'changedSince'>): Promise<SuiteResult> {
  return seams.runSuite({
    cwd: context.checkout,
    junitFile: junitFileFor(context.repoRoot, context.sessionId, kind),
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
  const settling: Settling = { kind: 'baseline', scope: 'full', label: 'suite baseline', result, baseline, blocks: false };
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

/** The run a task scope asks for. */
function taskNarrowing(scope: TaskStepScope, base: string): Pick<SuiteRunOptions, 'paths' | 'changedSince'> {
  if (scope.scope === 'full') return {};
  if (scope.scope === 'module') return { paths: scope.paths };
  return { changedSince: base };
}

/** The preload files, with a warning when `bunfig.toml` does not read. */
function preloadOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>): readonly string[] {
  const reading = seams.readPreloadFiles(context.checkout);
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  bunfig.toml does not read (${reading.reason}); no preload file is a full-suite trigger.`);
  return reading.files;
}

/** The task step's scope, or null when the diff did not read. */
async function taskScopeOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput): Promise<TaskStepScope | null> {
  const diff = readDiff(seams.git, input.base);
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

/** Runs the task step after a task commits; see the module note. */
export async function runTaskStep(context: SuiteStepContext, input: TaskStepInput): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const scope = await taskScopeOf(context, seams, input);
  const narrowing = scope === null
    ? {}
    : taskNarrowing(scope, input.base);
  const recorded = scope?.scope ?? 'full';
  const result = await runOne(context, seams, 'task', narrowing);
  const label = `task step after "${input.task}"`;
  return settleStep(context, seams, { kind: 'task', scope: recorded, label, result, baseline: input.baseline, blocks: true });
}

/** The commit a stage's diff is taken from: the last stage step's, else the baseline's. */
function stageSince(trackerPath: string, baseline: SuiteBaseline | null): string | null {
  const taken = readStageLedger(stageLedgerPathFor(trackerPath)).filter((entry) => entry.commit !== null);
  return taken.at(-1)?.commit ?? baseline?.commit ?? null;
}

/** The stage step's run: its paths, or the whole project when unnarrowed. */
async function stageNarrowing(context: SuiteStepContext, seams: Required<SuiteStepSeams>, baseline: SuiteBaseline | null): Promise<readonly string[] | null> {
  const since = stageSince(context.trackerPath, baseline);
  const diff = since === null
    ? null
    : readDiff(seams.git, since);
  if (diff === null) return null;
  const scope = stageStepScope({
    diff,
    owns: await context.owns(),
    integration: context.settings.testsIntegration,
    testFiles: seams.listTestFiles(context.checkout),
  });
  return scope.scope === 'full'
    ? null
    : scope.paths;
}

/** Runs the step of one stage and enters it in the ledger; see the module note. */
export async function runStageStep(context: SuiteStepContext, stage: DueStage, baseline: SuiteBaseline | null): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const commit = readHead(seams.git);
  const paths = await stageNarrowing(context, seams, baseline);
  const label = `stage step for "${stage.name}"`;
  if (paths !== null && paths.length === 0) {
    activeOutput().info(`🧪 ${label}: no test file under the Owns: folders it changed and no integration file; nothing to run.`);
    addToLedger(context.trackerPath, [{ ...stage, commit, via: 'step' }]);
    return { kind: 'stage', step: null, red: false, interrupted: false, blocker: null, blockedLine: null };
  }
  const result = await runOne(context, seams, 'stage', paths === null
    ? {}
    : { paths });
  const outcome = settleStep(context, seams, { kind: 'stage', scope: paths ?? 'full', label, result, baseline, blocks: true });
  if (!outcome.interrupted) addToLedger(context.trackerPath, [{ ...stage, commit, via: 'step' }]);
  return outcome;
}

/**
 * Runs every stage step due before the next dispatch, in order,
 * stopping after the first red or interrupted one. See the module note.
 */
export async function runDueStageSteps(context: SuiteStepContext, baseline: SuiteBaseline | null): Promise<readonly StepOutcome[]> {
  const ledger = readStageLedger(stageLedgerPathFor(context.trackerPath));
  const due = dueStages(readFileSync(context.trackerPath, 'utf8'), ledger);
  const outcomes: StepOutcome[] = [];
  for (const stage of due) {
    const outcome = await runStageStep(context, stage, baseline);
    outcomes.push(outcome);
    if (outcome.red || outcome.interrupted) break;
  }
  return outcomes;
}

/** Runs the full suite before the wrap-up; a red one writes no blocker. See the module note. */
export async function runPreWrapUpStep(context: SuiteStepContext, baseline: SuiteBaseline | null): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const result = await runOne(context, seams, 'pre-wrap-up', {});
  return settleStep(context, seams, { kind: 'pre-wrap-up', scope: 'full', label: 'pre-wrap-up step', result, baseline, blocks: false });
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
      activeOutput().info(`🗂  Stage steps run the full suite: ${owns.detail}.`);
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
