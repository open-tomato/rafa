/**
 * The preflight `loop start` runs before it dispatches any session, and
 * the notice every task prompt of the run carries for what it found
 * missing.
 *
 * `start()` calls {@link runStartPreflight} once, after the plan is known
 * and the branch guard has let the run through, and before the tracker
 * is created or the first session, the wrap-up's included, is spawned. It
 * hands the `known-missing:` lines the preflight answered to every
 * `dispatchTask`, whose `buildTaskPrompt` closes the prompt with
 * {@link knownMissingNotice}.
 *
 * ## What one preflight does, in order
 *
 *   1. **Generates the run's id**, `randomUUID` unless `newRunId`
 *      replaces it, before anything is checked. The id keys the store's
 *      rows, and is answered so a later stage can reuse it as the loop
 *      session's id.
 *   2. **Reads the items** through `loadPlanPrerequisites`: the config's
 *      two tiers, with the plan's `PREREQUISITES-<stub>.md` merged in for
 *      this plan alone (`preflight/prerequisites-md.ts`). A file there
 *      that cannot be read refuses the run before any probe runs.
 *   3. **Prints the reminders** that file carries, through `info`: each
 *      `human` item, and each `auto` item with no probe, by its line.
 *      A reminder is never checked and never halts, so a plan's unticked
 *      operator steps for after the merge stop nothing.
 *   4. **Checks every item** through `runPreflight`
 *      (`preflight/run.ts`), each probe run in the repo root with this
 *      process's environment unless `checks` names another. A failed
 *      optional item is warned about as it is found.
 *   5. **Stores a row per check** through `writePreflightChecks`
 *      (`effort/store/preflight.ts`), under the repo root in the SQLite
 *      store whatever `store` selects, so a halted run, which leaves no
 *      session row, still shows in `rafa effort report`.
 *   6. **Halts, or answers.** A failed required item, or rows that could
 *      not be stored, throws `CommandExit` (`cli/command.ts`) with exit
 *      code 1. Otherwise the run's id, the report, the reminders and the
 *      `known-missing:` lines are answered.
 *
 * A run with no item to check stores nothing and prints no preflight
 * line: `writePreflightChecks` is not called with no check, so a store
 * the run cannot open is left for the progress render ahead of the first
 * dispatch to meet, as it met it before the preflight existed.
 *
 * ## The refusals
 *
 * Each is thrown with exit code 1 and the whole refusal as its message,
 * as `start()` throws its other refusals, and each ends saying nothing
 * was dispatched. A halt opens with the runner's own text, which names
 * every failed required item, its probe, and its exit code with the first
 * line of stderr, then says where its rows went:
 *
 *     ❌ preflight halted: 1 required item failed
 *       tool "bun": probe `bun --version` exited 127: sh: bun: not found
 *        Nothing was dispatched. The checks are stored under run <id>,
 *        and `rafa effort report` lists the halt.
 *
 * Rows that could not be stored halt too, since a run whose checks the
 * store refused would meet the same store after its first task. With a
 * halt as well, the halt comes first and the store's refusal replaces the
 * sentence about where the rows went.
 *
 * ## The notice
 *
 * {@link knownMissingNotice} answers the `known-missing:` lines followed
 * by {@link KNOWN_MISSING_SENTENCE}, or nothing when there is no line, in
 * which case the prompt is the one the loop built before the preflight
 * existed. The notice sits after the injected plan text and before the
 * plan stamp `withStamp` appends: the prompt's first line is the `task`
 * classifier key (`effort/classify.ts`), and `planStubFromPrompt` answers
 * the first stamp a prompt holds (`utils/plan-stamp.ts`).
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { PreflightWriterSeams } from '../effort/store/preflight.js';
import type {
  PreflightItems,
  PrerequisiteReminder,
  PrerequisiteSettings,
} from '../preflight/prerequisites-md.js';
import type { PreflightOptions, PreflightReport } from '../preflight/run.js';

import { randomUUID } from 'crypto';
import { basename } from 'path';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { writePreflightChecks } from '../effort/store/preflight.js';
import { loadPlanPrerequisites, prerequisitesPathForPlan } from '../preflight/prerequisites-md.js';
import { runPreflight } from '../preflight/run.js';

/**
 * The sentence a task prompt carries after its `known-missing:` lines,
 * so the session neither repairs an absence nor works around it.
 */
export const KNOWN_MISSING_SENTENCE = 'A known-missing item is neither a bug to fix nor a credential to patch'
  + ' around: the preflight found it unavailable on this machine, so do the task without it.';

/** What {@link runStartPreflight} checks, and the seams it checks through. */
export interface StartPreflightOptions {
  /** The repo root: where each probe runs and the store's rows go. */
  readonly repoRoot: string;
  /** The plan the run executes; its `PREREQUISITES-<stub>.md` is merged in. */
  readonly planPath: string;
  /** The config's two prerequisite tiers, as the run resolved them. */
  readonly settings: PrerequisiteSettings;
  /** The runner's seams. Each left out is the runner's own default. */
  readonly checks?: Omit<PreflightOptions, 'cwd'>;
  /** Where the run's id comes from. `randomUUID` when left out. */
  readonly newRunId?: () => string;
  /** The clock the stored rows are stamped from. The system clock when left out. */
  readonly now?: PreflightWriterSeams['now'];
}

/** What a preflight that let the run through answers. */
export interface StartPreflight {
  /** The run's id, generated before anything was checked. */
  readonly runId: string;
  /** Every check, and the lines the runner worded. */
  readonly report: PreflightReport;
  /** The items the plan's PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** One `known-missing:` line per failed optional item, for every task prompt. */
  readonly knownMissing: readonly string[];
}

/**
 * The lines a task prompt closes with before its stamp: `lines`, then
 * {@link KNOWN_MISSING_SENTENCE}; none when `lines` is empty. See the
 * module note.
 */
export function knownMissingNotice(lines: readonly string[]): readonly string[] {
  return lines.length === 0
    ? []
    : [...lines, KNOWN_MISSING_SENTENCE];
}

/** The items for this plan, or the refusal of a PREREQUISITES file that cannot be read. */
async function loadItems(options: StartPreflightOptions): Promise<PreflightItems> {
  try {
    return await loadPlanPrerequisites(options.planPath, options.settings);
  } catch (error) {
    throw new CommandExit(1, [
      '❌ Refusing to start: the plan\'s prerequisites cannot be read.',
      `   ${messageOf(error)}`,
      '   Nothing was checked and nothing was dispatched.',
    ].join('\n'));
  }
}

/** Prints each reminder of the plan's PREREQUISITES file, by its line. */
function announceReminders(planPath: string, reminders: readonly PrerequisiteReminder[]): void {
  if (reminders.length === 0) return;
  const file = basename(prerequisitesPathForPlan(planPath) ?? planPath);
  const output = activeOutput();
  output.info(`\n📌 ${file} names ${reminders.length} step(s) the preflight does not check:`);
  for (const reminder of reminders) output.info(`   line ${reminder.line}: ${reminder.description}`);
}

/** Stores the report's checks, answering why they could not be stored, or null. */
function storeChecks(options: StartPreflightOptions, runId: string, report: PreflightReport): string | null {
  try {
    writePreflightChecks(options.repoRoot, { runId, checks: report.checks }, { now: options.now });
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/** The refusal for a halt, a store that refused the rows, or both; null for neither. */
function refusalOf(runId: string, halt: string | null, storeProblem: string | null): string | null {
  if (halt === null && storeProblem === null) return null;
  if (halt === null) {
    return [
      `❌ The preflight checks of run ${runId} could not be stored: ${storeProblem}`,
      '   Nothing was dispatched. Make the store writable, then run again.',
    ].join('\n');
  }
  const where = storeProblem === null
    ? `   Nothing was dispatched. The checks are stored under run ${runId},\n   and \`rafa effort report\` lists the halt.`
    : `   Nothing was dispatched. The checks of run ${runId} were not stored: ${storeProblem}`;
  return `❌ ${halt}\n${where}`;
}

/**
 * Runs the preflight of one `loop start` run and answers what the run's
 * sessions are handed, or throws `CommandExit` with exit code 1 for a
 * failed required item, rows the store refused, or a PREREQUISITES file
 * that cannot be read. See the module note.
 */
export async function runStartPreflight(options: StartPreflightOptions): Promise<StartPreflight> {
  const runId = (options.newRunId ?? randomUUID)();
  const items = await loadItems(options);
  announceReminders(options.planPath, items.reminders);

  const count = items.required.length + items.optional.length;
  if (count > 0) activeOutput().info(`\n🛫 Preflight: checking ${count} prerequisite item(s) under run ${runId}.`);

  const report = await runPreflight(items, { ...options.checks, cwd: options.repoRoot });
  const storeProblem = report.checks.length === 0
    ? null
    : storeChecks(options, runId, report);

  const refusal = refusalOf(runId, report.halt, storeProblem);
  if (refusal !== null) throw new CommandExit(1, refusal);

  if (count > 0) {
    const missing = report.knownMissing.length === 0
      ? ''
      : `; ${report.knownMissing.length} optional item(s) named known-missing in every task prompt`;
    activeOutput().info(`   Preflight passed${missing}.`);
  }

  return Object.freeze({
    runId,
    report,
    reminders: items.reminders,
    knownMissing: report.knownMissing,
  });
}
