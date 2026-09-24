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
 *   1. **Takes the run's id** from `newRunId`, `randomUUID` when it is
 *      left out, before anything is checked. The id keys the store's
 *      rows. `start()` hands in its session's id (`start/session.ts`),
 *      so the run id a halt names is the session's.
 *   2. **Checks the agent roster**, before any item is read and any
 *      probe is run, through `agents/roster.ts`: every `agent=` the
 *      still-to-run tasks of this run's checklist ask for, against the
 *      names a session under `agents.settingSources` would resolve. A
 *      name none of them answers refuses the run, because the dispatch
 *      it is routed to exits 1 before any model call
 *      (`context/workflow.md`). The tasks read are the ones the
 *      dispatcher will reach, a line a `rafa:*` block the document never
 *      closed hides included: `findNextTask` runs such a line, so the
 *      roster check reads it too (`PlanModel.hiddenTasks`), and the
 *      refusal names it by the document and the line as it names any
 *      other. The checklist read is the tracker when
 *      one is already beside the plan, and the plan otherwise, since the
 *      tracker is created after this preflight; a document that cannot
 *      be read is passed over, as the plan's own absence is refused by
 *      `start()` before this runs.
 *   3. **Reads the items** through `loadPlanPrerequisites`: the config's
 *      two tiers, with the plan's `PREREQUISITES-<stub>.md` merged in for
 *      this plan alone (`preflight/prerequisites-md.ts`). A file there
 *      that cannot be read refuses the run before any probe runs, and
 *      so does one holding a MALFORMED item: an `auto` or `start` item
 *      no command ends after a final `: `, which asked for a check and
 *      names none to run.
 *   4. **Adds the pull request provider's automatic items**, through
 *      `pr/preflight-items.ts`: `gh` on `PATH` and `gh auth status` for
 *      `origin`'s host, both REQUIRED, when the provider resolves to
 *      `gh`. They go AHEAD of the configured required tier, because a
 *      run whose pull request could never be opened should halt at its
 *      cheapest check rather than after the tiers a repository added.
 *   5. **Prints the reminders** that file carries, through `info`: each
 *      `human` item, by its line.
 *      A reminder is never checked and never halts, so a plan's unticked
 *      operator steps for after the merge stop nothing.
 *   6. **Decides the start-only tier**, through `isFirstDispatch`
 *      (`preflight/first-dispatch.ts`): the plan's `[start]` items are
 *      probed ahead of the configured required tier on a first
 *      dispatch, and on a resume each is skipped with one line naming
 *      it and why. See below.
 *   7. **Checks every item** through `runPreflight`
 *      (`preflight/run.ts`), each probe run in the repo root with this
 *      process's environment unless `checks` names another. A failed
 *      optional item is warned about as it is found.
 *   8. **Stores a row per check** through `writePreflightChecks`
 *      (`effort/store/preflight.ts`), under the repo root in the SQLite
 *      store whatever `store` selects, so a halted run, which leaves no
 *      session row, still shows in `rafa effort report`.
 *   9. **Halts, or answers.** A failed required item, or rows that could
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
 * An unresolvable agent refuses before any of that, naming the document
 * it read, the sources it resolved under, and every missing name with
 * the line that asked for it and the command that would fix it
 * (`missingAgentLine`):
 *
 *     ❌ Refusing to start: PLAN_TRACKER-demo.md names 1 agent(s) no
 *        loaded scope defines (loop.settingSources: project, local).
 *        agent "tdd-guide" (line 7) resolves under no loaded scope:
 *        run `rafa agent vendor tdd-guide`
 *        Nothing was checked and nothing was dispatched.
 *
 * A malformed item in the plan's PREREQUISITES file refuses before any
 * probe too, naming each by its line and the one shape a probed item
 * takes (`malformedPrerequisiteLines`), so a quoted name is never run
 * in place of the command (#140):
 *
 *     ❌ Refusing to start: PREREQUISITES-demo.md holds 1 malformed
 *        [auto] or [start] item(s): no command ends the item after a
 *        final ": ".
 *          line 4 [auto]: `gh --version` — the GitHub CLI on PATH
 *        Write each as - [ ] uv installed: `uvx --version`, ...
 *        Nothing was checked and nothing was dispatched.
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
 * ## The automatic items
 *
 * {@link automaticItems} resolves the provider (`pr/provider.ts`) from
 * `settings.prProvider` and the repo root's `origin`, and answers what
 * that reading contributes (`pr/preflight-items.ts`): two items for
 * `gh`, none for `none`. They are prepended to the required tier, so
 * they are checked first, they are counted in the line the preflight
 * opens with, they are stored as rows like any other check, and one
 * that fails halts the run before a session is paid for.
 *
 * A configured `pr.provider: none` answers with no item and reads no
 * remote at all: the operator has said, and `resolvePrProvider` would
 * otherwise spawn `git remote get-url origin` to reach the same answer.
 * Every other reading spawns it once, through `readRemote`, which is
 * this module's seam for that probe.
 *
 * ## The start-only tier
 *
 * A `[start]` item of the plan's PREREQUISITES file names the state the
 * run begins from — the sibling checkout holding no uncommitted change,
 * say — which the run's own sessions then change
 * (`preflight/prerequisites-md.ts`). So {@link startTier} probes those
 * items on a FIRST DISPATCH alone, the reading `isFirstDispatch`
 * (`preflight/first-dispatch.ts`) takes off the tracker beside the plan:
 * a tracker that already holds a ticked task makes the run a resume.
 *
 * On a first dispatch they sit between the provider's automatic items
 * and the configured required tier, so the state a plan says its run
 * begins from is read before the tiers a repository added and after the
 * two checks that cost nothing. They are required items there: they are
 * counted in the line the preflight opens with, stored as rows like any
 * other check, and one that fails halts the run.
 *
 * On a resume none of them is checked, so none is counted, stored, or
 * able to halt. Each is named instead in one line of its own, through
 * `info`, carrying the item and why it was passed over:
 *
 *     ⏭ start-only item tool "the sibling checkout is clean" was not
 *       checked: it is probed on a first dispatch alone, and
 *       PLAN_TRACKER-demo.md already holds a ticked task
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { ClaudeSettingSource, PrerequisiteItem, RafaConfig } from '../config.js';
import type { PreflightWriterSeams } from '../effort/store/preflight.js';
import type { ResolvePrProviderOptions } from '../pr/provider.js';
import type {
  PreflightItems,
  PrerequisiteReminder,
  PrerequisiteSettings,
} from '../preflight/prerequisites-md.js';
import type { PreflightOptions, PreflightReport, PreflightTiers } from '../preflight/run.js';

import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'path';

import { activeOutput } from '../adapters/output/active.js';
import { missingAgentLine, missingPlanAgents, resolveAgentRoster } from '../agents/roster.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { writePreflightChecks } from '../effort/store/preflight.js';
import { ghPreflightItems } from '../pr/preflight-items.js';
import { resolvePrProvider } from '../pr/provider.js';
import { isFirstDispatch } from '../preflight/first-dispatch.js';
import {
  loadPlanPrerequisites,
  malformedPrerequisiteLines,
  prerequisitesPathForPlan,
} from '../preflight/prerequisites-md.js';
import { runPreflight } from '../preflight/run.js';
import { trackerPathFor } from '../utils/tracker.js';

/**
 * The sentence a task prompt carries after its `known-missing:` lines,
 * so the session neither repairs an absence nor works around it.
 */
export const KNOWN_MISSING_SENTENCE = 'A known-missing item is neither a bug to fix nor a credential to patch'
  + ' around: the preflight found it unavailable on this machine, so do the task without it.';

/** What the agent roster is resolved against; see the module note. */
export interface StartPreflightAgents {
  /**
   * What each spawned session loads settings from, `loop.settingSources`
   * as the run resolved it. The config default when left out.
   */
  readonly settingSources?: readonly ClaudeSettingSource[];
  /** The home whose `.claude/agents` loads under `user`. `homedir()` when left out. */
  readonly home?: string;
}

/**
 * What the preflight reads off the config: the two prerequisite tiers,
 * and `pr.provider` for the automatic items. A `prProvider` left out
 * reads as null, which is the config's own default for it.
 */
export type StartPreflightSettings = PrerequisiteSettings & Partial<Pick<RafaConfig, 'prProvider'>>;

/** What {@link runStartPreflight} checks, and the seams it checks through. */
export interface StartPreflightOptions {
  /** The repo root: where each probe runs and the store's rows go. */
  readonly repoRoot: string;
  /** The plan the run executes; its `PREREQUISITES-<stub>.md` is merged in. */
  readonly planPath: string;
  /** The config's prerequisite tiers and provider, as the run resolved them. */
  readonly settings: StartPreflightSettings;
  /** The runner's seams. Each left out is the runner's own default. */
  readonly checks?: Omit<PreflightOptions, 'cwd'>;
  /** Where the run's id comes from. `randomUUID` when left out. */
  readonly newRunId?: () => string;
  /** The clock the stored rows are stamped from. The system clock when left out. */
  readonly now?: PreflightWriterSeams['now'];
  /** What the agent roster is resolved against. Each field left out is its own default. */
  readonly agents?: StartPreflightAgents;
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
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

/**
 * The checklist the roster check reads: the run's tracker when one is
 * already beside the plan, and the plan itself otherwise, since the
 * tracker is copied from the plan after this preflight.
 */
function agentSourcePath(planPath: string): string {
  const tracker = trackerPathFor(planPath);
  return existsSync(tracker)
    ? tracker
    : planPath;
}

/** The text at `path`, or null when nothing readable sits there. */
function readIfReadable(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Refuses the run when a still-to-run task routes to an agent no scope
 * the run loads defines, naming each with its fix; see the module note.
 */
function refuseUnresolvableAgents(options: StartPreflightOptions): void {
  const path = agentSourcePath(options.planPath);
  const markdown = readIfReadable(path);
  if (markdown === null) return;

  const settingSources = options.agents?.settingSources ?? CONFIG_DEFAULTS.settingSources;
  const roots = { repoRoot: options.repoRoot, home: options.agents?.home ?? homedir() };
  const missing = missingPlanAgents(markdown, resolveAgentRoster(roots, settingSources));
  if (missing.length === 0) return;

  throw new CommandExit(1, [
    `❌ Refusing to start: ${basename(path)} names ${missing.length} agent(s) no loaded scope`
      + ` defines (loop.settingSources: ${settingSources.join(', ')}).`,
    ...missing.map((agent) => `   ${missingAgentLine(agent)}`),
    '   Nothing was checked and nothing was dispatched.',
  ].join('\n'));
}

/** No item at all, for a tier that contributes none. */
const NO_ITEMS: readonly PrerequisiteItem[] = Object.freeze([]);

/**
 * The REQUIRED items the run's pull request provider contributes, ahead
 * of every configured item; see the module note.
 */
function automaticItems(options: StartPreflightOptions): readonly PrerequisiteItem[] {
  const configured = options.settings.prProvider ?? null;
  if (configured === 'none') return NO_ITEMS;

  return ghPreflightItems(resolvePrProvider({
    configured,
    dir: options.repoRoot,
    readRemote: options.readRemote,
  }));
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

/**
 * Refuses the run when the plan's PREREQUISITES file holds an `auto` or
 * `start` item with no command to probe, naming each by its line; see
 * the module note.
 */
function refuseMalformedItems(planPath: string, items: PreflightItems): void {
  if (items.malformed.length === 0) return;
  const file = basename(prerequisitesPathForPlan(planPath) ?? planPath);
  const [head = '', ...rest] = malformedPrerequisiteLines(file, items.malformed);
  throw new CommandExit(1, [
    `❌ Refusing to start: ${head}`,
    ...rest.map((line) => `   ${line}`),
    '   Nothing was checked and nothing was dispatched.',
  ].join('\n'));
}

/** The line naming one start-only item a resume passed over, and why. */
function skippedStartLine(item: PrerequisiteItem, tracker: string): string {
  return `⏭ start-only item ${item.kind} ${JSON.stringify(item.name)} was not checked:`
    + ' it is probed on a first dispatch alone,'
    + ` and ${tracker} already holds a ticked task`;
}

/** Prints one line per start-only item this resume passes over. */
function announceSkippedStart(planPath: string, skipped: readonly PrerequisiteItem[]): void {
  const tracker = basename(trackerPathFor(planPath));
  const output = activeOutput();
  for (const [index, item] of skipped.entries()) {
    const lead = index === 0
      ? '\n'
      : '';
    output.info(`${lead}${skippedStartLine(item, tracker)}`);
  }
}

/**
 * The start-only items this run probes: the plan's on a first dispatch,
 * and none on a resume, where each is named instead. See the module note.
 */
function startTier(planPath: string, items: PreflightItems): readonly PrerequisiteItem[] {
  if (items.startRequired.length === 0) return NO_ITEMS;
  if (isFirstDispatch(planPath)) return items.startRequired;

  announceSkippedStart(planPath, items.startRequired);
  return NO_ITEMS;
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
  refuseUnresolvableAgents(options);
  const items = await loadItems(options);
  refuseMalformedItems(options.planPath, items);
  announceReminders(options.planPath, items.reminders);

  const tiers: PreflightTiers = {
    required: [...automaticItems(options), ...startTier(options.planPath, items), ...items.required],
    optional: items.optional,
  };
  const count = tiers.required.length + tiers.optional.length;
  if (count > 0) activeOutput().info(`\n🛫 Preflight: checking ${count} prerequisite item(s) under run ${runId}.`);

  const report = await runPreflight(tiers, { ...options.checks, cwd: options.repoRoot });
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
