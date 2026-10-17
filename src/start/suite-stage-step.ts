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
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SessionStep, SessionStepReason } from '@open-tomato/rafa/core/loop';

import { readFileSync } from 'node:fs';

import { activeOutput } from '@open-tomato/rafa/core/output';

import { resolveChecks } from '../suite/checks.js';

import { takeRetakes } from './suite-retake-alone.js';
import { addToLedger, dueStages, readStageLedger, stageLedgerPathFor } from './suite-stage-ledger.js';
import {
  readDiff,
  readHead,
  runWithAlwaysRun,
  seamsOf,
  settleStep,
} from './suite-step.js';
import { readTaskAlwaysRun } from './task-always-run.js';

/** What a stage step runs: the whole project, a path list, or the `--changed` fallback from `since`. */
type StageRun =
  | { readonly scope: 'full' }
  | { readonly scope: 'paths'; readonly paths: readonly string[] }
  | { readonly scope: 'affected'; readonly since: string };

/** The entry a stage step resolves, today's: the touched `Owns:` folders' files and the integration tier. */
const STAGE_ENTRY = ['related', 'integration'] as const;

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

/** The stage step's run: its paths, the fallback without `Owns:`, or the whole project when its diff did not read. */
async function stageRunOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, baseline: SuiteBaseline | null): Promise<StageRunRead> {
  const since = stageSince(context.trackerPath, baseline);
  if (since === null) return { run: { scope: 'full' }, diff: null };
  const diff = readDiff(seams.git, since);
  if (diff === null) return { run: { scope: 'full' }, diff };
  const checks = resolveChecks({
    names: STAGE_ENTRY,
    declared: null,
    diff,
    owns: await context.owns(),
    testFiles: seams.listTestFiles(context.checkout),
    preload: [],
    fullSuiteTriggers: [],
    contract: [],
    integration: context.settings.testsIntegration,
  });
  // A `related` falling back without `Owns:` folders answers
  // `affectedToo`: the stage then runs the fallback alone, as it did.
  return checks.kind === 'paths' && !checks.affectedToo
    ? { run: { scope: 'paths', paths: checks.paths }, diff }
    : { run: { scope: 'affected', since }, diff };
}

/** The runs `run` asks for: the fallback joins the `tests.alwaysRun` files as a second run, the others none. */
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

/** The reason the run record holds for `run`: none for the full suite no scope rule chose. See `suite-step.ts`'s module note. */
function stageStepReason(run: StageRun): SessionStepReason | undefined {
  if (run.scope === 'full') return undefined;
  return run.scope === 'affected'
    ? 'fallback'
    : 'stage';
}

/** Runs the step of one stage and enters it in the ledger; see the module note. */
export async function runStageStep(context: SuiteStepContext, stage: DueStage, baseline: SuiteBaseline | null): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const commit = readHead(seams.git);
  const { run, diff } = await stageRunOf(context, seams, baseline);
  const label = `stage step for "${stage.name}"`;
  if (run.scope === 'paths' && run.paths.length === 0) {
    activeOutput().info(`🧪 ${label}: no test file under the Owns: folders it changed and no integration file; nothing to run.`);
    addToLedger(context.trackerPath, [{ ...stage, commit, via: 'step' }]);
    return { kind: 'stage', step: null, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false };
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
