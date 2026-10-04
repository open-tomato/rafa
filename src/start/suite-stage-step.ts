/**
 * The stage step the runner takes after each stage's last task, and its
 * catch-up for a stage whose step never ran: {@link runStageStep} for
 * one stage, {@link runDueStageSteps} for every stage due before the
 * next dispatch.
 *
 * The behaviour is described in `suite-step.ts`'s module note (the
 * stage step, the stage ledger and SIGINT), which stays the one account
 * of all four steps; this module only holds the stage step's code, and
 * `suite-step.ts` re-exports both functions so callers keep importing
 * them from there. The record, settle, retake and ledger helpers it
 * shares with the other steps live in `suite-step.ts`, imported back
 * here: the cycle is safe because neither module reads the other's
 * bindings at load, only inside the functions.
 */

import type { DueStage, StepOutcome, SuiteStepContext, SuiteStepSeams, Settling } from './suite-step.js';
import type { SuiteBaseline } from '../suite/baseline.js';

import { readFileSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { stageStepScope } from '../suite/scope.js';

import {
  addToLedger,
  dueStages,
  readDiff,
  readHead,
  readStageLedger,
  retakeOnErrors,
  runOne,
  seamsOf,
  settleStep,
  stageLedgerPathFor,
} from './suite-step.js';

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
  const narrowing = paths === null
    ? {}
    : { paths };
  const result = await runOne(context, seams, 'stage', narrowing);
  const settling: Settling = { kind: 'stage', scope: paths ?? 'full', label, result, baseline, repair: { kind: 'stage' } };
  const outcome = settleStep(context, seams, await retakeOnErrors(context, seams, settling, () => runOne(context, seams, 'stage', narrowing)));
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
