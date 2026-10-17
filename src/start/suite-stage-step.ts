/**
 * The stage step the runner takes after each stage's last task, and its
 * catch-up for a stage whose step never ran: {@link runStageStep} for
 * one stage, {@link runDueStageSteps} for every stage due before the
 * next dispatch.
 *
 * The behaviour is described in `suite-step.ts`'s module note (the
 * stage step and SIGINT), which stays the one account
 * of all four steps; this module only holds the stage step's code, and
 * `suite-step.ts` re-exports both functions so callers keep importing
 * them from there. The ledger it reads and writes is
 * `suite-stage-ledger.ts`'s. The run, record, settle and retake helpers
 * it shares with the other steps live in `suite-step.ts`, imported back
 * here: the cycle is safe because neither module reads the other's
 * bindings at load, only inside the functions.
 */

import type { DueStage } from './suite-stage-ledger.js';
import type { StepOutcome, StepRuns, SuiteStepContext, SuiteStepSeams, Settling } from './suite-step.js';
import type { CheckName } from '../config-schema-checks.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { CheckRun } from '../suite/checks.js';
import type { SessionStep, SessionStepReason } from '@open-tomato/rafa/core/loop';

import { readFileSync } from 'node:fs';

import { activeOutput } from '@open-tomato/rafa/core/output';

import { resolveChecks } from '../suite/checks.js';

import { takeRetakes } from './suite-retake-alone.js';
import { addToLedger, dueStages, readStageLedger, stageLedgerPathFor } from './suite-stage-ledger.js';
import {
  readDiff,
  readHead,
  recordStep,
  runWithAlwaysRun,
  seamsOf,
  settleStep,
} from './suite-step.js';
import { readTaskAlwaysRun } from './task-always-run.js';

/**
 * What a stage step runs: the whole project, a path list, or `--changed`
 * from `since`, each with the reason the run record holds, none for a
 * full suite no scope rule chose.
 */
type StageRun =
  | { readonly scope: 'full'; readonly reason: SessionStepReason | undefined }
  | { readonly scope: 'paths'; readonly paths: readonly string[] }
  | { readonly scope: 'affected'; readonly since: string; readonly reason: SessionStepReason };

/** The checks whose answer is a path list, read off the project's test files. */
const PATH_CHECKS: ReadonlySet<CheckName> = new Set(['related', 'unit', 'contract', 'integration']);

/** The commit a stage's diff is taken from: the last stage step's, else the baseline's. */
function stageSince(trackerPath: string, baseline: SuiteBaseline | null): string | null {
  const taken = readStageLedger(stageLedgerPathFor(trackerPath)).filter((entry) => entry.commit !== null);
  return taken.at(-1)?.commit ?? baseline?.commit ?? null;
}

/** A stage step's run, and the stage's diff it was chosen over, or null when there was none to read. */
interface StageRunRead {
  readonly run: StageRun;
  readonly diff: readonly string[] | null;
}

/** The preload files when `names` holds `affected`, the only check a trigger widens; a `bunfig.toml` that does not read is a warning. */
function stagePreload(context: SuiteStepContext, seams: Required<SuiteStepSeams>, names: readonly CheckName[]): readonly string[] {
  if (!names.includes('affected')) return [];
  const reading = seams.readPreloadFiles(context.checkout);
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  bunfig.toml does not read (${reading.reason}); no preload file is a full-suite trigger.`);
  return reading.files;
}

/** `checks.stage`'s answer over the stage's diff; `Owns:`, the test files and the preload files are read only when the entry needs them. */
async function stageChecksOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, names: readonly CheckName[], diff: readonly string[]): Promise<CheckRun> {
  return resolveChecks({
    names,
    declared: null,
    diff,
    owns: names.includes('related')
      ? await context.owns()
      : null,
    testFiles: names.some((name) => PATH_CHECKS.has(name))
      ? seams.listTestFiles(context.checkout)
      : [],
    preload: stagePreload(context, seams, names),
    fullSuiteTriggers: context.settings.testsFullSuiteTriggers,
    contract: context.settings.testsContract,
    integration: context.settings.testsIntegration,
  });
}

/**
 * The stage run `checks` answers: a path list beside which an `affected`
 * stands runs that `affected` alone, as the stage's fallback without
 * `Owns:` folders always has, reason `declared` when the entry names it
 * and `fallback` when `related` fell back to it. See the module note.
 */
function stageRunFor(checks: Exclude<CheckRun, { readonly kind: 'none' }>, names: readonly CheckName[], since: string): StageRun {
  if (checks.kind === 'full') return { scope: 'full', reason: checks.reason };
  if (checks.kind === 'affected') return { scope: 'affected', since, reason: checks.reason };
  if (!checks.affectedToo) return { scope: 'paths', paths: checks.paths };
  const reason = names.includes('affected')
    ? 'declared'
    : 'fallback';
  return { scope: 'affected', since, reason };
}

/** The stage step's run for a non-empty entry: its answer over the stage's diff, or the whole project when there is no diff to read. */
async function stageRunOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, baseline: SuiteBaseline | null, names: readonly CheckName[]): Promise<StageRunRead> {
  const since = stageSince(context.trackerPath, baseline);
  if (since === null) return { run: { scope: 'full', reason: undefined }, diff: null };
  const diff = readDiff(seams.git, since);
  if (diff === null) return { run: { scope: 'full', reason: undefined }, diff };
  const checks = await stageChecksOf(context, seams, names, diff);
  // An empty entry never reaches here: `runStageStep` answers it first.
  return checks.kind === 'none'
    ? { run: { scope: 'paths', paths: [] }, diff }
    : { run: stageRunFor(checks, names, since), diff };
}

/** The runs `run` asks for: an `affected` run joins the `tests.alwaysRun` files as a second run, the others none. */
function stageRuns(context: SuiteStepContext, seams: Required<SuiteStepSeams>, run: StageRun): StepRuns {
  if (run.scope === 'full') return { narrowing: {}, alwaysRun: [], timed: [] };
  if (run.scope === 'paths') return { narrowing: { paths: run.paths }, alwaysRun: [], timed: [] };
  const alwaysRun = readTaskAlwaysRun(seams.git, context.settings.testsAlwaysRun, 'stage');
  return { narrowing: { changedSince: run.since }, alwaysRun, timed: [] };
}

/** The scope the run record holds for `run`. */
function recordedScope(run: StageRun): SessionStep['scope'] {
  return run.scope === 'paths'
    ? run.paths
    : run.scope;
}

/** The reason the run record holds for `run`: `stage` for a path list, the run's own otherwise. See `suite-step.ts`'s module note. */
function stageStepReason(run: StageRun): SessionStepReason | undefined {
  return run.scope === 'paths'
    ? 'stage'
    : run.reason;
}

/** The `none` step the run record holds for an empty `checks.stage`; see `suite-step.ts`'s module note. */
function noCheckStep(): SessionStep {
  return { kind: 'stage', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] };
}

/** What a stage step that blocked nothing answers, holding `step` or none. */
function settledQuietly(step: SessionStep | null): StepOutcome {
  return { kind: 'stage', step, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false };
}

/** Runs the step of one stage and enters it in the ledger; see the module note. */
export async function runStageStep(context: SuiteStepContext, stage: DueStage, baseline: SuiteBaseline | null): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const commit = readHead(seams.git);
  const label = `stage step for "${stage.name}"`;
  const names = context.settings.checksStage;
  if (names.length === 0) {
    const step = noCheckStep();
    recordStep(seams, step);
    activeOutput().info(`🧪 ${label}: no check configured (checks.stage is empty); nothing ran.`);
    addToLedger(context.trackerPath, [{ ...stage, commit, via: 'step' }]);
    return settledQuietly(step);
  }
  const { run, diff } = await stageRunOf(context, seams, baseline, names);
  if (run.scope === 'paths' && run.paths.length === 0) {
    activeOutput().info(`🧪 ${label}: no test file under the Owns: folders it changed and no integration file; nothing to run.`);
    addToLedger(context.trackerPath, [{ ...stage, commit, via: 'step' }]);
    return settledQuietly(null);
  }
  const runs = stageRuns(context, seams, run);
  const result = await runWithAlwaysRun(context, seams, 'stage', runs);
  const settling: Settling = { kind: 'stage', scope: recordedScope(run), reason: stageStepReason(run), label, result, baseline, repair: { kind: 'stage', stage: stage.stage } };
  const outcome = settleStep(context, seams, await takeRetakes(context, seams, settling, () => runWithAlwaysRun(context, seams, 'stage', runs), () => diff));
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
