/**
 * The stage ledger: whether each stage's step was taken, kept beside
 * the plan's tracker across runs, and which stages a step is due for.
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
 * makes a finished stage's step run again: the safe side. The ledger is
 * written, as the baseline is, through a temporary file renamed into
 * place.
 *
 * The steps themselves are described in `suite-step.ts`'s module note,
 * which re-exports this module's exports but {@link completeStages};
 * this module holds only the ledger, and imports nothing from the steps.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { parsePlan } from '@open-tomato/rafa/core/plan';

import { BASELINE_FILE_PREFIX, baselinePathFor } from '../suite/baseline.js';
import { findNextTask } from '../utils/tracker.js';

/** The stage ledger's file name before its stub. */
export const STAGE_LEDGER_PREFIX = 'SUITE_STAGES';

/** The version the ledger is written at, and the only one read. */
export const STAGE_LEDGER_VERSION = 1;

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
export function completeStages(trackerContent: string): readonly DueStage[] {
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
