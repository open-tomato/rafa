/**
 * What `loop start` does with the doc task's report: the `stale_docs`
 * entries of the task declared `docs=repair` (`core/plan/declaration.ts`)
 * are the documentation lines it could NOT settle. Each is stored as an
 * `unsettled` row and added as one line to the release's stale-docs
 * issue (`docs/release-issue.ts`), or, in a run with no tracker that can
 * hold that issue, kept for one print after the last task.
 *
 * `start()` makes one {@link StartStaleDocs} per run through
 * {@link createStartStaleDocs}, hands it every task right after the
 * task's report is stored and triaged, and asks it for its print once,
 * as the run ends, however it ends.
 *
 * ## Which report
 *
 * Only a report of a task declared `docs=repair` whose task ended
 * `done`, and holding at least one `stale_docs` entry. Every other task's
 * entries are `sighting` rows `report/record.ts` already stored, and are
 * left alone here. A doc task that ended blocked, failed or interrupted
 * has not finished its repair: its next attempt reports again, and only
 * the attempt that ends `done` says what is left. So nothing is stored,
 * resolved or added for one.
 *
 * ## The rows
 *
 * The entries go through `writeStaleDocs` (`effort/store/stale-docs.ts`)
 * under the kind `unsettled`, as the report parsed them. A refused entry
 * is warned about, and the others are stored; a store that cannot be
 * written is warned about, and the lines are still added. The store's
 * own `sighting` write of the same report, by the report's store step,
 * stands beside these rows: the table's unique index holds the kind, so
 * neither drops the other.
 *
 * ## The lines
 *
 * The version the issue is titled for is read once per run, when the
 * first line is added, through `staleDocsVersion`: release off reads as
 * `next` with nothing else read; otherwise the settle forecast over the
 * fragments waiting on `origin/<pr.base>` as last fetched, and the
 * version that base declares, else the version file in the checkout
 * (the forecast `rafa release status` prints, read here from the
 * release modules, since nothing outside `src/commands/` imports it).
 * Nothing of it throws; an unreadable forecast is the patch bump, and an
 * unreadable version `next`.
 *
 * The tracker is the run's chain (`resolveTracker`), resolved at most
 * once per run, on the first line to add, and never for a run whose doc
 * task left nothing: a resolution runs `gh auth status` and
 * `gh repo view` for `github`. A chain that lands nowhere is null, and
 * one that lands on a tracker with no `openIssues` or no `edit` cannot
 * hold the issue either: `addStaleDocLine` answers `kept` for both, with
 * no call made.
 *
 * Each entry is redacted before it is handed on, since the issue is
 * public: of the run's named secrets (`namedSecrets` over the config's
 * prerequisite tiers and the environment) first, matched byte for byte,
 * then of local paths under the project root, the checkout and the home
 * directory. The rows are stored as reported, as every report's are.
 *
 * ## Ticking a doc-update plan's line
 *
 * A plan `rafa docs plan` wrote, titled `chore(doc-update)`, holds one
 * task per open line of the release's stale-docs issues. When such a
 * task ends `done`, its line is ticked in the issue the plan's
 * `rafa:plan` block names, through `tickStaleDocLine`, over the same
 * once-resolved tracker; a task that ended blocked, failed or
 * interrupted leaves its line open. The plan is read from `planPath`
 * once, on the first task ended `done`; a run handed no `planPath`, a
 * plan of any other title, or a task whose text names no line ticks
 * nothing. A doc-update plan naming no issue, an issue no longer open
 * and a failed call are each one warning; a line the issue no longer
 * holds unticked is one note, since a person may have settled it.
 *
 * ## The print after the last task
 *
 * A line answered `kept` is collected, once per text, and
 * {@link StartStaleDocs.atRunEnd} prints them all under one heading
 * naming the issue they would have gone to, then forgets them, so a
 * second call prints nothing. A run with no kept line prints nothing.
 *
 * ## A failure never stops the run
 *
 * Nothing here rejects or throws. A store that refused, a tracker call
 * that failed and anything thrown are each one warning, as triage's
 * failures are (`start/triage.ts`): the task's commit, mark, stored
 * report and triage were settled before, and the loop goes on, or stops,
 * as it would have.
 *
 * Every line goes through the active output (`core/output/active.ts`):
 * what was added and the print through `info`, everything that was not
 * through `warn`.
 */
import type { TaskDispatch } from './dispatch.js';
import type { ResolveTrackerOptions, TrackerResolution } from '../adapters/tracker/resolve.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { IssueRef } from '@open-tomato/rafa/ports';
import type { ReportStaleDoc } from '@open-tomato/rafa/report/parse';
import type { FindingOutcome, FindingsWriterSeams } from '@open-tomato/rafa/store/findings';
import type { StaleDocsWriteResult } from '@open-tomato/rafa/store/stale-docs';
import type {
  GitRunner,
  SecretEnvironment,
  StaleDocEntry,
  StaleDocLineResult,
  StaleDocTickResult,
  StaleDocsTracker,
} from '@open-tomato/rafa-pr';
import type { FoldFragment, SettleForecast } from '@open-tomato/rafa-release';

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

import {
  DOC_UPDATE_TITLE,
  addStaleDocLine,
  createGitRunner,
  docUpdateLineText,
  localPathRedactor,
  namedSecrets,
  redactSecrets,
  staleDocLineText,
  staleDocsVersion,
  tickStaleDocLine,
} from '@open-tomato/rafa-pr';
import {
  RELEASE_BASE_BRANCH,
  RELEASE_REMOTE,
  forecastSettle,
  readFragmentTree,
  readManifestVersion,
  releaseStrategyFor,
  resolveReleaseEnabled,
  versionAt,
} from '@open-tomato/rafa-release';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { parsePlan , readDocsRole } from '@open-tomato/rafa/core/plan';
import { parseReport } from '@open-tomato/rafa/report/parse';
import { writeStaleDocs } from '@open-tomato/rafa/store/stale-docs';

import { resolveTracker } from '../adapters/tracker/resolve.js';

/** What every line this module prints opens with, after its indent. */
const LINE_PREFIX = 'Stale docs: ';

/** The indent every printed line takes, as the dispatch indents its own. */
const INDENT = '   ';

/** The config keys the handler reads: the chain, the secrets and the release. */
export type StartStaleDocsConfig = Pick<
  RafaConfig,
  | 'trackerDefault'
  | 'trackerFallback'
  | 'prerequisitesRequired'
  | 'prerequisitesOptional'
  | 'prBase'
  | 'releaseEnabled'
  | 'releaseVersionFile'
  | 'releaseChangelog'
  | 'releaseFragments'
  | 'releaseStrategy'
  | 'releaseHeading'
>;

/** What the run's handler is made with. */
export interface StartStaleDocsOptions {
  /** The project root: the store, and the chain's context. */
  readonly repoRoot: string;
  /** The run's checkout, where git reads the forecast and the version file is read. */
  readonly checkout: string;
  /** The plan the run executes, read for a doc-update plan's issue. No line is ticked when left out. */
  readonly planPath?: string;
  /** The run's resolved config. */
  readonly config: StartStaleDocsConfig;
  /** The home directory lines are redacted of. `homedir()` when left out. */
  readonly home?: string;
  /** The environment the secrets' values are read from. `process.env` when left out. */
  readonly env?: SecretEnvironment;
  /** Resolves the chain. `resolveTracker` over the core registry when left out. */
  readonly resolve?: (options: ResolveTrackerOptions) => Promise<TrackerResolution>;
  /** Reads the version the issue is titled for. {@link readStaleDocsVersion} when left out. */
  readonly readVersion?: () => string;
  /** Seams for the row write. */
  readonly seams?: FindingsWriterSeams;
}

/** One task whose report `start()` has just stored and triaged. */
export interface StaleDocsTaskInput {
  /** The plan the run executes, or null when its file name gives none. */
  readonly planStub: string | null;
  /** The session's id, the task sentence, what it declared and everything it wrote. */
  readonly dispatch: Pick<TaskDispatch, 'sessionId' | 'taskText' | 'output' | 'declaration'>;
  /** What the loop made of the task. */
  readonly outcome: FindingOutcome;
}

/** What the handler did with one task: the doc task's report, a doc-update task's line, or both. */
export interface StaleDocsHandling {
  /** What the `unsettled` write did, or null when the store threw or the task is no doc task. */
  readonly stored: StaleDocsWriteResult | null;
  /** What became of each entry's line, in the report's order. */
  readonly lines: readonly StaleDocLineResult[];
  /** What ticking a doc-update task's line did, or null when the task is none. */
  readonly ticked: StaleDocTickResult | null;
}

/** The loop's handler of the doc task's report, one per run. */
export interface StartStaleDocs {
  /**
   * Handles one task: null for any task but a `docs=repair` task ended
   * `done` with an entry, or a doc-update plan's task ended `done`.
   * Never rejects; see the module note.
   */
  readonly afterTask: (input: StaleDocsTaskInput) => Promise<StaleDocsHandling | null>;
  /** Prints the kept lines once, under one heading, and answers what it printed. */
  readonly atRunEnd: () => readonly string[];
}

/** The version file's value in `checkout`, or null when it cannot be read. */
function localVersion(checkout: string, versionFile: string): string | null {
  const path = resolvePath(checkout, versionFile);
  if (!existsSync(path)) return null;
  try {
    return readManifestVersion(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The settle forecast and the base's version, as far as they could be read. */
interface BaseReading {
  readonly forecast: SettleForecast | null;
  readonly baseVersion: string | null;
}

/**
 * What settling the fragments waiting on `origin/<pr.base>` would
 * release, read as `rafa release status` reads it: nothing for a tree
 * git cannot list, a base version it cannot read, or a fragment that
 * does not parse, since settle refuses that batch.
 */
function readBase(git: GitRunner, config: StartStaleDocsConfig): BaseReading {
  const ref = `${RELEASE_REMOTE}/${config.prBase ?? RELEASE_BASE_BRANCH}`;
  const listed = readFragmentTree(git, ref, config.releaseFragments);
  if (!listed.ok) return { forecast: null, baseVersion: null };
  const base = versionAt(git, listed.commit, config.releaseVersionFile);
  const baseVersion = 'version' in base
    ? base.version
    : null;
  if (baseVersion === null) return { forecast: null, baseVersion };

  const folded: FoldFragment[] = [];
  for (const each of listed.fragments) {
    if (!each.reading.ok) return { forecast: null, baseVersion };
    folded.push({ id: each.id, addedOn: each.addedOn, fragment: each.reading.fragment });
  }
  const strategy = releaseStrategyFor(config.releaseStrategy, { heading: config.releaseHeading });
  return { forecast: forecastSettle({ strategy, baseVersion, waiting: folded }), baseVersion };
}

/**
 * The version the stale-docs issue is titled for, as the module note
 * reads it. `git` runs in the checkout. Never throws: a read that throws
 * is a forecast of none and no base version.
 */
export function readStaleDocsVersion(
  options: Pick<StartStaleDocsOptions, 'repoRoot' | 'checkout' | 'config'>,
  git: GitRunner = createGitRunner(options.checkout),
): string {
  const { config } = options;
  const releaseEnabled = resolveReleaseEnabled(config, options.repoRoot).enabled;
  if (!releaseEnabled) return staleDocsVersion({ releaseEnabled, forecast: null, versionFileValue: null });
  let base: BaseReading = { forecast: null, baseVersion: null };
  try {
    base = readBase(git, config);
  } catch {
    // Read as no forecast: the version file in the checkout names the patch bump.
  }
  return staleDocsVersion({
    releaseEnabled,
    forecast: base.forecast,
    versionFileValue: base.baseVersion ?? localVersion(options.checkout, config.releaseVersionFile),
  });
}

/** True for a report this module handles; see the module note. */
function isDocTaskDone(input: StaleDocsTaskInput): boolean {
  return input.outcome === 'done' && readDocsRole(input.dispatch.declaration) === 'repair';
}

/** The line one result tells the operator, and whether it is a warning. */
function resultLine(result: StaleDocLineResult, text: string): { readonly warn: boolean; readonly line: string } {
  switch (result.action) {
    case 'created':
      return { warn: false, line: `opened ${refName(result.ref)}, ${result.title}, with: ${text}` };
    case 'appended':
      return { warn: false, line: `added to ${refName(result.ref)}, ${result.title}: ${text}` };
    case 'held':
      return { warn: false, line: `${refName(result.ref)}, ${result.title}, already holds: ${text}` };
    case 'kept':
      return { warn: false, line: `kept for the print after the last task (${result.reason}): ${text}` };
    case 'failed':
      return { warn: true, line: `not added to ${result.title}: ${result.problem}` };
  }
}

/** What a doc-update plan names, or null for a plan of any other title. */
interface DocUpdatePlan {
  /** The issue its `rafa:plan` block names, or null when it names none. */
  readonly issue: string | null;
}

/** A Markdown heading naming a plan's title. */
const PLAN_TITLE = /^# Plan:[ \t]*(.*?)[ \t]*\r?$/m;

/** The doc-update plan at `planPath`, or null for any other plan; throws for a plan that cannot be read. */
function readDocUpdatePlan(planPath: string): DocUpdatePlan | null {
  const markdown = readFileSync(planPath, 'utf8');
  if (PLAN_TITLE.exec(markdown)?.[1] !== DOC_UPDATE_TITLE) return null;
  return { issue: parsePlan(markdown).header.issue };
}

/** The line one tick tells the operator, and whether it is a warning. */
function tickLine(result: StaleDocTickResult, text: string): { readonly warn: boolean; readonly line: string } {
  switch (result.action) {
    case 'ticked':
      return { warn: false, line: `ticked in ${refName(result.ref)}: ${text}` };
    case 'absent':
      return { warn: false, line: `${refName(result.ref)} no longer holds the line unticked: ${text}` };
    case 'no-issue':
      return { warn: true, line: `not ticked, no open stale-docs issue ${result.issue}: ${text}` };
    case 'untracked':
      return { warn: false, line: `not ticked (${result.reason}): ${text}` };
    case 'failed':
      return { warn: true, line: `not ticked: ${result.problem}` };
  }
}

/** How a line names an issue: its URL, or its kind and id when it has none. */
function refName(ref: IssueRef): string {
  return ref.url ?? `${ref.kind} issue ${ref.externalId}`;
}

/** Makes the run's handler: no tracker resolved, no version read. See the module note. */
export function createStartStaleDocs(options: StartStaleDocsOptions): StartStaleDocs {
  const secrets = namedSecrets(options.config, options.env ?? process.env);
  const local = localPathRedactor([options.repoRoot, options.checkout], options.home ?? homedir());
  const redact = (text: string): string => local(redactSecrets(text, secrets));
  const kept = new Map<string, string>();
  let version: string | null = null;
  let tracker: Promise<StaleDocsTracker | null> | null = null;
  let docUpdatePlan: DocUpdatePlan | null | undefined;

  const versionOnce = (): string => {
    version ??= (options.readVersion ?? (() => readStaleDocsVersion(options)))();
    return version;
  };

  const resolveOnce = (): Promise<StaleDocsTracker | null> => {
    tracker ??= (options.resolve ?? resolveTracker)({
      config: options.config,
      context: { repoRoot: options.repoRoot },
    }).then(
      (resolution) => resolution.tracker,
      (error: unknown) => {
        activeOutput().warn(`${INDENT}${LINE_PREFIX}no tracker resolved for the release's stale-docs issue: ${redact(messageOf(error))}`);
        return null;
      },
    );
    return tracker;
  };

  const store = (input: StaleDocsTaskInput, staleDocs: readonly ReportStaleDoc[]): StaleDocsWriteResult | null => {
    try {
      const result = writeStaleDocs(options.repoRoot, {
        dispatch: { sessionId: input.dispatch.sessionId, planStub: input.planStub, taskLine: input.dispatch.taskText },
        outcome: input.outcome,
        kind: 'unsettled',
        staleDocs,
      }, options.seams);
      for (const rejection of result.rejected) activeOutput().warn(`${INDENT}${LINE_PREFIX}${rejection.text}`);
      return result;
    } catch (error) {
      activeOutput().warn(`${INDENT}${LINE_PREFIX}the unsettled rows were not stored: ${redact(messageOf(error))}`);
      return null;
    }
  };

  const addLine = async (entry: StaleDocEntry): Promise<StaleDocLineResult> => {
    const result = await addStaleDocLine({ tracker: await resolveOnce(), version: versionOnce(), entry });
    const text = staleDocLineText(entry);
    if (result.action === 'kept') kept.set(text, result.title);
    const { warn, line } = resultLine(result, text);
    if (warn) activeOutput().warn(`${INDENT}${LINE_PREFIX}${line}`);
    else activeOutput().info(`${INDENT}${LINE_PREFIX}${line}`);
    return result;
  };

  const docUpdatePlanOnce = (): DocUpdatePlan | null => {
    if (docUpdatePlan !== undefined) return docUpdatePlan;
    try {
      docUpdatePlan = options.planPath === undefined
        ? null
        : readDocUpdatePlan(options.planPath);
    } catch (error) {
      activeOutput().warn(`${INDENT}${LINE_PREFIX}the plan was not read for its stale-docs issue: ${redact(messageOf(error))}`);
      docUpdatePlan = null;
    }
    if (docUpdatePlan?.issue === null) {
      activeOutput().warn(`${INDENT}${LINE_PREFIX}the ${DOC_UPDATE_TITLE} plan names no issue, so no line is ticked`);
    }
    return docUpdatePlan;
  };

  const tick = async (input: StaleDocsTaskInput): Promise<StaleDocTickResult | null> => {
    if (input.outcome !== 'done') return null;
    const issue = docUpdatePlanOnce()?.issue ?? null;
    const text = docUpdateLineText(input.dispatch.taskText);
    if (issue === null || text === null) return null;
    const result = await tickStaleDocLine({ tracker: await resolveOnce(), issue, text });
    const { warn, line } = tickLine(result, text);
    if (warn) activeOutput().warn(`${INDENT}${LINE_PREFIX}${line}`);
    else activeOutput().info(`${INDENT}${LINE_PREFIX}${line}`);
    return result;
  };

  const repair = async (input: StaleDocsTaskInput): Promise<Omit<StaleDocsHandling, 'ticked'> | null> => {
    if (!isDocTaskDone(input)) return null;
    const reading = parseReport(input.dispatch.output);
    if (!reading.present || reading.report.staleDocs.length === 0) return null;

    const { staleDocs } = reading.report;
    const stored = store(input, staleDocs);
    const lines: StaleDocLineResult[] = [];
    for (const each of staleDocs) {
      const where = each.where === null
        ? null
        : redact(each.where);
      lines.push(await addLine({ where, what: redact(each.what) }));
    }
    return { stored, lines };
  };

  const handle = async (input: StaleDocsTaskInput): Promise<StaleDocsHandling | null> => {
    const ticked = await tick(input);
    const repaired = await repair(input);
    if (ticked === null && repaired === null) return null;
    return { stored: repaired?.stored ?? null, lines: repaired?.lines ?? [], ticked };
  };

  return {
    afterTask: async (input) => {
      try {
        return await handle(input);
      } catch (error) {
        activeOutput().warn(`${INDENT}${LINE_PREFIX}nothing more was done with the doc task's report: ${redact(messageOf(error))}`);
        return null;
      }
    },
    atRunEnd: () => {
      if (kept.size === 0) return [];
      const title = [...kept.values()][0] ?? '';
      const printed = [
        `📝 Stale documentation the doc task could not settle, with no tracker to hold "${title}":`,
        ...[...kept.keys()].map((text) => `${INDENT}- [ ] ${text}`),
      ];
      kept.clear();
      for (const line of printed) activeOutput().info(line);
      return printed;
    },
  };
}
